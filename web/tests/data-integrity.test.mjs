/**
 * Data-integrity tests.
 *
 * Two kinds of check, and the second is the one that matters:
 *
 * 1. Invariants in the database itself — one ACTIVE model per pathogen, no
 *    medicine carrying two live probabilities for one organism, no stored pose
 *    without a score.
 * 2. Reconciliation between the database and the rendered pages. Every figure
 *    checked here is read from Postgres, then looked for in the HTML the server
 *    actually produced. A page that hardcodes a number, or that keeps serving a
 *    figure after the data moves, fails here.
 *
 * Run against a server that is already up:
 *   node --test tests/                      (defaults to http://127.0.0.1:3222)
 *   BASE_URL=http://127.0.0.1:3000 node --test tests/
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3222";

function readEnv() {
  const file = path.join(here, "..", ".env.local");
  const text = fs.readFileSync(file, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

let sql;

before(() => {
  const env = readEnv();
  assert.ok(env.DATABASE_URL, "DATABASE_URL must be set in web/.env.local");
  sql = postgres(env.DATABASE_URL, {
    prepare: false,
    // The pooler can take tens of seconds to complete a handshake from far away.
    connect_timeout: 60,
    connection: { search_path: "amr,public" },
  });
});

after(async () => {
  await sql?.end();
});

/** Digits as the interface groups them: 1691 → "1,691". */
const grouped = (value) => Number(value).toLocaleString("en-GB");

/*
  A page that does not answer is a failure, and says so. Without a deadline the
  HTTP client waited 300 seconds for response headers before giving up, which is
  how one check came to take five minutes. The site bounds every database read
  (two attempts of at most 40 s), so two minutes is ample for any page.
*/
const PAGE_DEADLINE_MS = 120_000;

async function html(route) {
  const res = await fetch(`${BASE_URL}${route}`, {
    signal: AbortSignal.timeout(PAGE_DEADLINE_MS),
  });
  assert.equal(res.status, 200, `${route} should render`);
  return res.text();
}

/** The data version the database is at now (see migration 0003). */
async function currentDataVersion() {
  const [row] = await sql`select count(*) as n, max(xact_id) as last from data_changes`;
  return `${row.n}.${row.last ?? 0}`;
}

/** The data version a rendered page says its figures were read at. */
function renderedDataVersion(page) {
  const match = page.match(/<meta name="amr-data-version" content="([^"]+)"/);
  return match ? match[1] : null;
}

/*
  A page's figures were read at the version it declares. If that is the version
  the database is at, no figure on it can have come from before a publish —
  which a count-by-count comparison cannot prove on its own, because a stale
  cache and a quiet database show the same numbers.
*/
async function assertCurrent(route, page) {
  const now = await currentDataVersion();
  assert.equal(
    renderedDataVersion(page),
    now,
    `${route} must be rendered from the current data version (${now}), not a cached one`,
  );
}

/* ------------------------------------------------------------------ */
/* Database invariants                                                 */
/* ------------------------------------------------------------------ */

describe("registry invariants", () => {
  it("has exactly one ACTIVE model per modelled pathogen", async () => {
    const rows = await sql`
      select pathogen_key, count(*) as n from model_versions
       where status = 'ACTIVE' group by pathogen_key order by pathogen_key`;
    assert.equal(rows.length, 4, "four pathogens must have a model");
    for (const row of rows) {
      assert.equal(Number(row.n), 1, `${row.pathogen_key} must have exactly one ACTIVE model`);
    }
  });

  it("never gives one molecule two live probabilities for one pathogen", async () => {
    const [row] = await sql`
      select count(*) as n from (
        select p.molecule_id, p.pathogen_key, count(*) as c
          from predictions p
          join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
         group by p.molecule_id, p.pathogen_key
        having count(*) > 1
      ) t`;
    assert.equal(Number(row.n), 0, "a retrain must not leave two ACTIVE predictions in place");
  });

  it("stores no successful pose without a score", async () => {
    const [row] = await sql`
      select count(*) as n from docking_results
       where status = 'ok' and score_kcal_mol is null`;
    assert.equal(Number(row.n), 0);
  });

  it("keeps 'no evidence found' distinguishable from 'not yet checked'", async () => {
    const [row] = await sql`
      select
        (select count(*) from clinical_queries)                     as queried,
        (select count(*) from clinical_queries where n_results = 0) as none_found,
        (select count(distinct molecule_id) from drugs
          where molecule_id is not null)                            as medicines`;
    assert.ok(Number(row.queried) > 0, "the registry sweep must have run");
    assert.ok(
      Number(row.none_found) > 0,
      "medicines that returned nothing must be recorded, not dropped",
    );
    assert.ok(
      Number(row.queried) <= Number(row.medicines),
      "more queries than medicines would mean duplicate query rows",
    );
  });

  it("records every write to the published tables as a data change", async () => {
    // The website keys its read cache on this log. A table without the trigger
    // could change without the version moving, and the site would go on
    // showing what it held before.
    const rows = await sql`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'amr' and c.relkind in ('r', 'p') and c.relname <> 'data_changes'
         and not exists (
           select 1 from pg_trigger t
            where t.tgrelid = c.oid and t.tgname = 'record_data_change' and t.tgenabled <> 'D')
       order by c.relname`;
    assert.deepEqual(
      rows.map((r) => r.relname),
      [],
      "every table in the amr schema must carry an enabled record_data_change trigger",
    );
  });

  it("labels every prediction with the dataset it came from", async () => {
    const [row] = await sql`
      select count(*) as n from predictions p
       join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
      where p.dataset_version is null`;
    assert.equal(Number(row.n), 0, "a prediction without a dataset cannot be traced");
  });
});

/* ------------------------------------------------------------------ */
/* Database → interface reconciliation                                 */
/* ------------------------------------------------------------------ */

/*
  The website's discovery floor, read from the source that sets it rather than
  typed again here — so the test checks the page against the constant the page
  itself uses.
*/
function discoveryThreshold() {
  const source = fs.readFileSync(path.join(here, "..", "src", "lib", "science.ts"), "utf8");
  const match = source.match(/export const DISCOVERY_THRESHOLD = ([0-9.]+);/);
  assert.ok(match, "science.ts must declare DISCOVERY_THRESHOLD");
  return Number(match[1]);
}

const ACTIVE = "join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'";

/** A rendered model percentage: the value followed by its label. */
const PERCENT_WITH_LABEL = /%<\/span>\s*(?:<!-- -->)?\s*<span[^>]*>AI-predicted activity/;

/** A probability as the investigation view prints it (one decimal). */
function shown(probability) {
  const p = Number(probability);
  if (p >= 0.995) return ">99%";
  if (p <= 0.005 && p > 0) return "<1%";
  return `${(p * 100).toFixed(1)}%`;
}

describe("the dashboard counts medicines, not prediction rows", () => {
  it("shows the live totals, with the activity count as distinct medicines", async () => {
    const floor = discoveryThreshold();
    const [row] = await sql.unsafe(
      `select
         (select count(distinct molecule_id) from drugs where molecule_id is not null) as medicines,
         (select count(distinct p.molecule_id) from predictions p ${ACTIVE}
           where p.probability >= $1
             and p.molecule_id in (select molecule_id from drugs))                     as with_activity,
         (select count(distinct nct_id) from clinical_trials)                          as studies`,
      [floor],
    );

    const page = await html("/");
    await assertCurrent("/", page);
    for (const [label, value] of Object.entries(row)) {
      assert.ok(page.includes(grouped(value)), `dashboard should show ${label} = ${grouped(value)}`);
    }
    assert.ok(page.includes(`≥${Math.round(floor * 100)}%`), "the floor is stated beside the count");
  });

  it("counts each pathogen independently, and never sums them into the total", async () => {
    const floor = discoveryThreshold();
    const perPathogen = await sql.unsafe(
      `select p.pathogen_key, count(distinct p.molecule_id) as n
         from predictions p ${ACTIVE}
        where p.probability >= $1 and p.molecule_id in (select molecule_id from drugs)
        group by p.pathogen_key order by p.pathogen_key`,
      [floor],
    );
    assert.equal(perPathogen.length, 4, "all four pathogens must have qualifying medicines");

    const [overall] = await sql.unsafe(
      `select count(*) as n from (
         select p.molecule_id from predictions p ${ACTIVE}
          where p.probability >= $1 and p.molecule_id in (select molecule_id from drugs)
          group by p.molecule_id) t`,
      [floor],
    );
    const sum = perPathogen.reduce((a, r) => a + Number(r.n), 0);
    assert.ok(Number(overall.n) <= sum, "a union can never exceed the sum of its parts");
    assert.ok(
      Number(overall.n) >= Math.max(...perPathogen.map((r) => Number(r.n))),
      "the union is at least the largest single pathogen",
    );

    // A medicine that qualifies for one pathogen only still counts once.
    const [single] = await sql.unsafe(
      `select count(*) as n from (
         select p.molecule_id from predictions p ${ACTIVE}
          where p.probability >= $1 group by p.molecule_id having count(*) = 1) t`,
      [floor],
    );
    assert.ok(Number(single.n) > 0, "single-pathogen medicines exist and are part of the union");

    const page = await html("/");
    for (const r of perPathogen) {
      assert.ok(page.includes(grouped(r.n)), `dashboard should show ${r.pathogen_key} = ${grouped(r.n)}`);
    }
    if (sum !== Number(overall.n)) {
      assert.ok(!page.includes(`>${grouped(sum)}<`), "the pathogen counts must not be summed on the page");
    }
  });
});

describe("a medicine opens with its own four predictions", () => {
  it("shows every ACTIVE prediction for Levoketoconazole, labelled", async () => {
    const rows = await sql`
      select p.molecule_id, p.pathogen_key, p.probability from predictions p
        join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
        join drugs d on d.molecule_id = p.molecule_id
       where lower(d.generic_name) = 'levoketoconazole'
       group by p.molecule_id, p.pathogen_key, p.probability`;
    assert.equal(rows.length, 4, "one ACTIVE prediction per pathogen");

    const route = `/investigate/${rows[0].molecule_id}`;
    const page = await html(route);
    await assertCurrent(route, page);
    for (const r of rows) {
      assert.ok(page.includes(shown(r.probability)), `${r.pathogen_key} should read ${shown(r.probability)}`);
    }
    assert.ok(page.includes("AI-predicted activity"), "every percentage carries its label");
  });

  it("lists other medicines above the floor, excluding itself, and each one opens", async () => {
    const floor = discoveryThreshold();
    const [self] = await sql`
      select molecule_id from drugs where lower(generic_name) = 'levoketoconazole' limit 1`;
    const [expected] = await sql.unsafe(
      `select count(*) as n from predictions p ${ACTIVE}
        where p.pathogen_key = 'mtb' and p.probability >= $1 and p.molecule_id <> $2
          and p.molecule_id in (select molecule_id from drugs)`,
      [floor, self.molecule_id],
    );

    const route = `/investigate/${self.molecule_id}?p=mtb`;
    const page = await html(route);
    // React separates adjacent text with `<!-- -->`; read the text as shown.
    const text = page.replace(/<!-- -->/g, "");
    assert.ok(text.includes(`of ${grouped(expected.n)} medicines`), "candidate total matches the database");

    const links = [...page.matchAll(/href="\/investigate\/([A-Z0-9-]+)"/g)]
      .map((m) => m[1])
      .filter((id) => id !== self.molecule_id);
    assert.ok(links.length > 0, "other medicines are listed as links");
    assert.ok(!links.includes(self.molecule_id), "the searched medicine is not its own candidate");

    const other = await html(`/investigate/${links[0]}`);
    const [count] = await sql.unsafe(
      `select count(*) as n from predictions p ${ACTIVE} where p.molecule_id = $1`,
      [links[0]],
    );
    assert.equal(Number(count.n), 4, "the opened medicine has all four predictions");
    assert.equal((other.match(/AI-predicted activity<\/span>/g) ?? []).length >= 4, true);
  });

  it("says a medicine with no structure has no prediction and was not checked", async () => {
    const [row] = await sql`
      select min(generic_name) as name from drugs where molecule_id is null`;
    const page = await html(`/investigate?medicine=${encodeURIComponent(row.name)}`);
    assert.ok(/No AI prediction for this medicine/.test(page));
    assert.ok(/not yet checked/i.test(page), "must not read as a negative result");
    assert.ok(!PERCENT_WITH_LABEL.test(page), "no AI percentage at all");
  });
});

describe("the percentage gate holds for conditions", () => {
  it("shows no probability for a condition with no model", async () => {
    const page = await html("/investigate?condition=Migraine");
    assert.ok(
      /No AI activity model is currently available for this condition/.test(page),
      "an unmodelled condition must say so explicitly",
    );
    assert.ok(!/Other medicines to investigate/.test(page), "no computational candidates without a model");
    assert.ok(!PERCENT_WITH_LABEL.test(page), "no AI percentage at all");
  });

  it("maps a supported condition and keeps documented medicines out of the candidates", async () => {
    const floor = discoveryThreshold();
    const page = await html("/investigate?condition=Tuberculosis");
    assert.ok(/Supported pathogen/.test(page) && page.includes("M. tuberculosis"));
    assert.ok(/not presented as established treatments/.test(page));

    // The first candidate the database would list, after removing every
    // medicine with a TB study or a lab record against M. tuberculosis.
    const [first] = await sql.unsafe(
      `select p.molecule_id from predictions p ${ACTIVE}
        where p.pathogen_key = 'mtb' and p.probability >= $1
          and p.molecule_id in (select molecule_id from drugs)
          and p.molecule_id not in (
            select ct.molecule_id from clinical_trials ct
             where ct.molecule_id is not null
               and ((' ' || replace(lower(ct.conditions), ';', ' ') || ' ') like '%tuberculosis%'
                 or (' ' || replace(lower(ct.conditions), ';', ' ') || ' ') like '% tb %'
                 or (' ' || replace(lower(ct.conditions), ';', ' ') || ' ') like '%latent tb%')
            union select b.molecule_id from bioactivity b
             where b.pathogen_key = 'mtb' and b.label is not null)
        order by p.probability desc limit 1`,
      [floor],
    );
    assert.ok(first, "tuberculosis has computational candidates");
    const candidates = page.slice(page.indexOf("Other medicines to investigate"));
    assert.ok(candidates.includes(first.molecule_id), "the first candidate matches the database");
  });
});

describe("registered studies filter by condition", () => {
  it("dashboard filter matches the registry rows", async () => {
    const [row] = await sql`
      select count(distinct nct_id) as n from clinical_trials
       where (' ' || replace(lower(conditions), ';', ' ') || ' ') like '%tuberculosis%'`;
    const page = await html("/?sc=tuberculosis");
    assert.ok(page.includes(grouped(row.n)), `shows ${grouped(row.n)} studies`);
    assert.ok(/does not establish a positive result/.test(page));
  });

  it("a condition with no studies says no evidence found, not no effect", async () => {
    const page = await html("/investigate?condition=Zzqx%20fever");
    assert.ok(/no evidence found, not evidence of no effect/i.test(page));
  });
});

describe("retired sections stay retired", () => {
  for (const route of ["/dashboard", "/screening", "/candidates", "/explorer", "/models", "/runs", "/retraining"]) {
    it(`${route} redirects to the dashboard`, async () => {
      const res = await fetch(`${BASE_URL}${route}`, { redirect: "manual" });
      assert.ok([307, 308].includes(res.status), `${route} should redirect`);
      assert.equal(new URL(res.headers.get("location"), BASE_URL).pathname, "/");
    });
  }
});

const PUBLIC_ROUTES = [
  "/",
  "/?sc=tuberculosis",
  "/investigate/XMAYWYJOQHXEEK-ZEQKJWHPSA-N",
  "/investigate?condition=Tuberculosis",
  "/investigate?condition=Migraine",
  "/investigate?medicine=cipro",
];

describe("no page exposes the machinery", () => {
  const TECHNICAL = [
    /RF-(mrsa|ecoli|kpneumoniae|mtb)-v\d/,
    /DS-20\d{6}/,
    /RDKit/,
    /Morgan/,
    /Random Forest/i,
    /scaffold/i,
    /PR-AUC/,
    /Supabase/i,
    /model_versions|clinical_trials|dataset_members/,
    /Docker/,
  ];
  for (const route of PUBLIC_ROUTES) {
    it(`${route} shows no internal identifiers`, async () => {
      const res = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(PAGE_DEADLINE_MS) });
      const visible = (await res.text())
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<[^>]+>/g, " ");
      for (const pattern of TECHNICAL) {
        assert.ok(!pattern.test(visible), `${route} must not show ${pattern}`);
      }
    });
  }
});

describe("no page claims clinical benefit", () => {
  const FORBIDDEN = [
    /\d+\s*%\s*(effective|efficacy|success|cure)/i,
    /proven to treat/i,
    /clinically effective/i,
    /recommended for treatment/i,
    /best (alternative|candidate|drug|medicine)s?/i,
    /top (\d+ )?candidates/i,
  ];

  for (const route of PUBLIC_ROUTES) {
    it(`${route} carries no efficacy language`, async () => {
      const page = await html(route);
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(page), `${route} must not match ${pattern}`);
      }
    });
  }
});
