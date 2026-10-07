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
        (select count(*) from clinical_queries
          where molecule_id in (select molecule_id from drugs))     as queried,
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
    assert.equal(Number(row.queried), Number(row.medicines), "every library medicine has been searched");
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

/*
  The repurposing-candidate definition, written out again here from the brief
  rather than imported from the site: one medicine per structure, AI-predicted
  activity at or above the floor (for one pathogen, or any), and not already an
  antibacterial by the stored classification. If the site's query drifts from
  this, the counts stop matching.
*/
function candidateSql(pathogen) {
  return `select distinct d.molecule_id from drugs d
     where d.molecule_id is not null
       and d.molecule_id in (select molecule_id from molecules where is_valid)
       and d.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
                              where p.probability >= $1${pathogen ? ` and p.pathogen_key = '${pathogen}'` : ""})
       and d.molecule_id in (select molecule_id from medicine_use_status where is_antibacterial = 'false')`;
}

async function candidateIds(pathogen) {
  const rows = await sql.unsafe(candidateSql(pathogen), [discoveryThreshold()]);
  return new Set(rows.map((r) => r.molecule_id));
}

const PATHOGENS = ["mrsa", "ecoli", "kpneumoniae", "mtb"];

/** Text as a reader sees it: React's `<!-- -->` separators removed. */
const readable = (page) => page.replace(/<!-- -->/g, "");

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF rows. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function csv(route) {
  const res = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(PAGE_DEADLINE_MS) });
  assert.equal(res.status, 200, `${route} should download`);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /attachment/);
  const text = await res.text();
  const [header, ...rows] = parseCsv(text);
  // The file name says what it is: project, population, row count, date.
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "";
  assert.match(name, /^smart-screening_[a-z-]+_\d+-rows_\d{4}-\d{2}-\d{2}\.csv$/, `${route} file name: ${name}`);
  assert.ok(name.includes(`_${rows.length}-rows_`), "the name carries the true row count");
  return { text, header, rows };
}

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
  it("shows the library, the repurposing candidates and the reconciliation between them", async () => {
    const floor = discoveryThreshold();
    const [row] = await sql.unsafe(
      `select
         (select count(distinct molecule_id) from drugs where molecule_id is not null) as medicines,
         (select count(distinct p.molecule_id) from predictions p ${ACTIVE}
           where p.probability >= $1
             and p.molecule_id in (select molecule_id from drugs))                     as with_activity,
         (select count(*) from (${candidateSql()}) c)                                  as candidates`,
      [floor],
    );
    const [ab] = await sql.unsafe(
      `select count(distinct p.molecule_id) as n from predictions p ${ACTIVE}
        where p.probability >= $1 and p.molecule_id in (select molecule_id from drugs)
          and p.molecule_id in (select molecule_id from medicine_use_status where is_antibacterial = 'true')`,
      [floor],
    );
    const removed = Number(ab.n);
    assert.ok(removed > 0, "some existing antibacterials reach the floor and are set aside");
    assert.ok(Number(row.candidates) < Number(row.with_activity));

    const page = readable(await html("/dashboard"));
    await assertCurrent("/dashboard", page);
    for (const [label, value] of Object.entries(row)) {
      assert.ok(page.includes(grouped(value)), `dashboard should show ${label} = ${grouped(value)}`);
    }
    assert.ok(page.includes(`− ${grouped(removed)}`), "the antibacterials set aside are shown");
    assert.ok(/Repurposing candidates/.test(page) && /Approved medicines/.test(page));
    assert.ok(/matched to the FDA Orange Book/.test(page), "the library is described as Orange Book matches");
    assert.ok(page.includes(`≥${Math.round(floor * 100)}%`), "the floor is stated beside the count");
  });

  it("counts each pathogen independently, and never sums them into the total", async () => {
    const floor = discoveryThreshold();
    const perPathogen = [];
    for (const key of PATHOGENS) {
      perPathogen.push({ pathogen_key: key, n: (await candidateIds(key)).size });
    }
    assert.ok(perPathogen.every((r) => r.n > 0), "all four pathogens must have candidates");

    const overall = { n: (await candidateIds()).size };
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

    const page = await html("/dashboard");
    for (const r of perPathogen) {
      assert.ok(page.includes(`href="/investigate?pathogen=${r.pathogen_key}"`), "each card opens its full list");
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

  it("draws the medicine's own structure, and a structure for each listed medicine", async () => {
    const [self] = await sql`
      select d.molecule_id from drugs d join molecules m on m.molecule_id = d.molecule_id
       where lower(d.generic_name) = 'levoketoconazole' and m.is_valid limit 1`;
    const page = await html(`/investigate/${self.molecule_id}?p=mtb`);
    assert.ok(page.includes('alt="Chemical structure of Levoketoconazole"'), "own structure is drawn");
    const drawn = (page.match(/alt="Chemical structure of /g) ?? []).length;
    assert.ok(drawn >= 2, "listed medicines carry their structures too");

    // The drawing is served as a cacheable image, not inlined into the page.
    const res = await fetch(`${BASE_URL}/api/structure/${self.molecule_id}?size=lg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /image\/svg\+xml/);
    assert.match(res.headers.get("cache-control") ?? "", /public/);
    assert.ok((await res.text()).includes("<svg"), "the image is an SVG drawing");

    const missing = await fetch(`${BASE_URL}/api/structure/NOT-A-REAL-KEY?size=sm`);
    assert.equal(missing.status, 404, "no structure is a 404, never a stand-in drawing");
  });

  it("lists other medicines above the floor, excluding itself, and each one opens", async () => {
    const floor = discoveryThreshold();
    const [self] = await sql`
      select molecule_id from drugs where lower(generic_name) = 'levoketoconazole' limit 1`;
    const pool = await candidateIds("mtb");
    pool.delete(self.molecule_id);
    const expected = { n: pool.size };
    void floor;

    const route = `/investigate/${self.molecule_id}?p=mtb`;
    const page = await html(route);
    // React separates adjacent text with `<!-- -->`; read the text as shown.
    const text = page.replace(/<!-- -->/g, "");
    assert.ok(text.includes(`of ${grouped(expected.n)} medicines`), "candidate total matches the database");

    const links = [...page.matchAll(/href="\/investigate\/([A-Z0-9-]+)(?:\?p=[a-z]+)?"/g)]
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
          and p.molecule_id in (select molecule_id from medicine_use_status where is_antibacterial = 'false')
          and p.molecule_id in (select molecule_id from molecules where is_valid)
        order by p.probability desc limit 1`,
      [floor],
    );
    assert.ok(first, "tuberculosis has computational candidates");
    const candidates = page.slice(page.indexOf("Other medicines to investigate"));
    assert.ok(candidates.includes(first.molecule_id), "the first candidate matches the database");
    assert.ok(/Existing use: /.test(candidates), "each candidate shows its existing use");
    assert.ok(/not already antimicrobials/.test(candidates), "the exclusion is stated");

    const antibacterials = await sql`select molecule_id from medicine_use_status where status = 'antibacterial'`;
    for (const r of antibacterials) {
      assert.ok(!candidates.includes(`/investigate/${r.molecule_id}?`), `${r.molecule_id} is an antibacterial, not a candidate`);
    }
  });
});

describe("colitis is not E. coli", () => {
  // "ulcerativE COLItis" contains "e coli"; an unpadded pattern read every
  // colitis study as E. coli evidence and opened the percentage gate.
  it("ulcerative colitis has no model and shows no percentage", async () => {
    const page = await html("/investigate?condition=Ulcerative%20Colitis");
    assert.ok(/No AI activity model is currently available for this condition/.test(page));
    assert.ok(!/Supported pathogen/.test(page));
    assert.ok(!PERCENT_WITH_LABEL.test(page), "no AI percentage at all");
  });

  it("the E. coli page lists no colitis-only study", async () => {
    const page = await html("/investigate?condition=E.%20coli%20infection");
    assert.ok(/Supported pathogen/.test(page));
    assert.ok(!/Ulcerative Colitis/i.test(readable(page)), "no ulcerative colitis study under E. coli");
  });
});

describe("medicine search answers with the medicine searched for", () => {
  // A combination product is stored once per ingredient, each row carrying the
  // product's brand, so brand matching once answered "aspirin" with butalbital.
  const names = async (q) =>
    (await (await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}`)).json()).map((h) => h.name);

  it("a generic name finds that medicine, not its combination partners", async () => {
    assert.deepEqual(await names("aspirin"), ["ASPIRIN"]);
    assert.deepEqual(await names("cipro"), ["CIPROFLOXACIN"]);
  });

  it("a combination brand still finds its ingredients, and says so", async () => {
    const hits = await (await fetch(`${BASE_URL}/api/search?q=aggrenox`)).json();
    assert.deepEqual(hits.map((h) => h.name).sort(), ["ASPIRIN", "DIPYRIDAMOLE"]);
    for (const h of hits) assert.match(h.note, /AGGRENOX, a combination product/);
  });
});

describe("registered studies filter by condition", () => {
  it("dashboard filter matches the registry rows", async () => {
    const [row] = await sql`
      select count(distinct nct_id) as n from clinical_trials
       where (' ' || replace(lower(conditions), ';', ' ') || ' ') like '%tuberculosis%'`;
    const page = await html("/dashboard?sc=tuberculosis");
    assert.ok(page.includes(grouped(row.n)), `shows ${grouped(row.n)} studies`);
    assert.ok(/does not establish a positive result/.test(page));
  });

  it("a condition with no studies says no evidence found, not no effect", async () => {
    const page = await html("/investigate?condition=Zzqx%20fever");
    assert.ok(/no evidence found, not evidence of no effect/i.test(page));
  });
});

describe("retired sections stay retired", () => {
  for (const route of ["/screening", "/candidates", "/explorer", "/models", "/runs", "/retraining"]) {
    it(`${route} redirects to the dashboard`, async () => {
      const res = await fetch(`${BASE_URL}${route}`, { redirect: "manual" });
      assert.ok([307, 308].includes(res.status), `${route} should redirect`);
      assert.equal(new URL(res.headers.get("location"), BASE_URL).pathname, "/dashboard");
    });
  }
});

describe("the overview carries the presentation's figures and sections", () => {
  it("shows the broader molecular dataset apart from the medicine library", async () => {
    const [row] = await sql.unsafe(`select count(*) as n from molecules where is_valid`);
    const page = await html("/");
    assert.ok(page.includes(`${Math.floor(Number(row.n) / 1000)}K`), "the 20K figure is shown");
    assert.ok(page.includes(grouped(row.n)), "with its exact count");
    assert.ok(/Broader molecular dataset/.test(page) && /Approved-medicine library/.test(page));
  });

  it("explains how the site works with all five stages and the step not taken", async () => {
    const page = await html("/");
    assert.ok(/id="how-it-works"/.test(page));
    for (const stage of ["Collect", "Represent", "Predict", "Check fit", "Check evidence"]) {
      assert.ok(page.includes(`>${stage}<`), `stage ${stage}`);
    }
    for (const step of ["Prediction", "Structural hypothesis", "Existing evidence"]) {
      assert.ok(page.includes(step), step);
    }
    assert.ok(/Not performed in this project/i.test(page), "laboratory testing is marked as not performed");
  });

  it("presents exactly the four modelled species", async () => {
    const page = await html("/");
    // One tab per species, each naming the resistance feature slide 5 gives it.
    const tabs = page.match(/role="tab"/g) ?? [];
    assert.equal(tabs.length, 4, "exactly four species");
    for (const label of ["MRSA", "E. coli", "K. pneumoniae", "M. tuberculosis"]) {
      assert.ok(page.includes(label), label);
    }
    for (const feature of [
      "Altered PBP2a target",
      "Outer membrane + drug efflux",
      "Carbapenemase enzymes",
      "Waxy mycolic-acid-rich cell envelope",
    ]) {
      assert.ok(page.includes(feature), feature);
    }
  });

  for (const route of ["/", "/dashboard"]) {
    it(`${route} uses neutral labels for the pathogen list`, async () => {
      const page = await html(route);
      assert.ok(!/AI[- ]supported pathogens|target pathogen|What is this site trying to tell you/i.test(page));
    });
  }

  it("the dashboard names the four species 'Pathogen coverage'", async () => {
    assert.ok(/Pathogen coverage/.test(await html("/dashboard")));
  });
});

describe("the full method page", () => {
  it("is linked from the overview's training section", async () => {
    assert.ok(/href="\/methods"/.test(await html("/")));
  });

  it("names its sources, explains training and reading, and keeps the limits", async () => {
    const page = readable(await html("/methods"));
    for (const source of ["ChEMBL", "FDA Orange Book", "ClinicalTrials.gov", "Protein Data Bank"]) {
      assert.ok(page.includes(source), source);
    }
    assert.ok(/How to read a result/.test(page) && /How the training worked/.test(page));
    assert.ok(/no new patient or laboratory experiments were performed/i.test(page));
    assert.ok(/never added together/.test(page), "the two populations are kept apart");
  });

  it("shows no internal identifiers or metrics", async () => {
    const res = await fetch(`${BASE_URL}/methods`, { signal: AbortSignal.timeout(PAGE_DEADLINE_MS) });
    const visible = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
    for (const pattern of [/RF-(mrsa|ecoli|kpneumoniae|mtb)-v\d/, /DS-20\d{6}/, /PR-AUC/, /Supabase/i, /Docker/]) {
      assert.ok(!pattern.test(visible), `must not show ${pattern}`);
    }
  });
});

describe("registered studies are shown from the stored record", () => {
  it("lists registry ids as text, with the record opening in place", async () => {
    const page = await html("/dashboard");
    assert.ok(/NCT\d{8}/.test(page), "registry ids are shown");
    assert.ok(!/href="https:\/\/clinicaltrials\.gov\/study\//.test(page), "no outbound registry links");
    assert.ok(/Registered record/.test(page), "the stored record can be opened");
  });
});

describe("the overview explains, and discovery waits for a search", () => {
  it("the overview shows the live counts in plain words", async () => {
    const floor = discoveryThreshold();
    const [row] = await sql.unsafe(
      `select
         (select count(distinct molecule_id) from drugs where molecule_id is not null) as medicines,
         (select count(*) from (${candidateSql()}) c)                                  as candidates`,
      [floor],
    );
    const page = await html("/");
    await assertCurrent("/", page);
    assert.ok(page.includes(grouped(row.medicines)) && page.includes(grouped(row.candidates)));
    assert.ok(/What is drug repurposing\?/.test(page), "the overview explains repurposing");
    // How to read a result moved to the full method page, linked from here.
    assert.ok(/href="\/methods"/.test(page) && /how to read a result/i.test(page), "the overview links to it");
    assert.ok(/How to read a result/.test(await html("/methods")), "the method page explains it");
  });

  for (const route of ["/", "/dashboard"]) {
    it(`${route} lists no candidates before a search`, async () => {
      const page = await html(route);
      assert.ok(!page.includes(">Other medicines to investigate<"), "candidates appear only on a result");
    });
  }
});

describe("documented evidence links to its source", () => {
  it("each laboratory record links to its ChEMBL assay and publication", async () => {
    const [rec] = await sql`
      select b.molecule_id, b.assay_chembl_id, b.document_chembl_id from bioactivity b
       where b.molecule_id = 'MYSWGUAQZAJSOK-UHFFFAOYSA-N' and b.label is not null
       order by b.pathogen_key, case when b.document_year is null then 1 else 0 end,
                b.document_year desc, b.assay_chembl_id
       limit 1`;
    const page = await html(`/investigate/${rec.molecule_id}`);
    assert.ok(page.includes("/chembl/explore/compound/CHEMBL8"), "compound link");
    assert.ok(/laboratory records, with sources/.test(page), "the records panel is offered");

    // The rows load when the panel is opened; they are the database's rows.
    const res = await fetch(`${BASE_URL}/api/lab-records/${rec.molecule_id}`);
    assert.equal(res.status, 200);
    const rows = await res.json();
    const [total] = await sql`
      select count(*) as n from bioactivity
       where molecule_id = ${rec.molecule_id} and label is not null`;
    assert.equal(rows.length, Math.min(150, Number(total.n)), "one row per record, capped at 150");
    assert.equal(rows[0].assayId, rec.assay_chembl_id, "same first record as the database");
    assert.equal(rows[0].documentId, rec.document_chembl_id, "with its publication");
  });

  it("a docking result links to the protein structure it used", async () => {
    const [row] = await sql`
      select t.pdb_id from docking_results dr join targets t on t.target_key = dr.target_key
       where dr.molecule_id = 'XMAYWYJOQHXEEK-ZEQKJWHPSA-N' and dr.status = 'ok' limit 1`;
    const page = await html("/investigate/XMAYWYJOQHXEEK-ZEQKJWHPSA-N");
    assert.ok(page.includes(`rcsb.org/structure/${row.pdb_id}`));
  });

  // Registry pages render in the browser and failed to show the record for
  // readers, so each study shows its registry id as text and its stored record
  // in place, instead of linking out.
  it("every registered study shows its registry id and stored record", async () => {
    const page = await html("/investigate/XMAYWYJOQHXEEK-ZEQKJWHPSA-N");
    const ids = await sql`
      select distinct nct_id from clinical_trials
       where molecule_id = 'XMAYWYJOQHXEEK-ZEQKJWHPSA-N'`;
    for (const { nct_id } of ids) assert.ok(page.includes(nct_id), `${nct_id} is shown`);
    const records = page.match(/>Registered record</g) ?? [];
    assert.equal(records.length, ids.length, "one stored record per study");
    assert.equal((page.match(/href="https:\/\/clinicaltrials\.gov\/[^"]+"/g) ?? []).length, 0, "no outbound registry links");
  });
});

describe("each pathogen opens its complete list of repurposing candidates", () => {
  for (const key of PATHOGENS) {
    it(`${key}: the list total matches the dashboard and the database, and every page is reachable`, async () => {
      const ids = await candidateIds(key);
      const page = readable(await html(`/investigate?pathogen=${key}`));
      await assertCurrent(`/investigate?pathogen=${key}`, page);
      assert.ok(page.includes(`All ${grouped(ids.size)} repurposing candidates`), `shows all ${ids.size}`);
      assert.ok(/Sorted by AI-predicted activity/.test(page), "the order is labelled");
      assert.ok(PERCENT_WITH_LABEL.test(page), "every percentage carries its label");
      assert.ok(/Existing use: /.test(page), "each row shows its existing use");

      const dashboard = readable(await html("/dashboard"));
      assert.ok(dashboard.includes(`See all ${grouped(ids.size)} candidates`), "the card shows the same number");

      // The last page holds exactly the remainder: nothing is cut off.
      const pageSize = 24;
      const last = Math.max(1, Math.ceil(ids.size / pageSize));
      const tail = await html(`/investigate?pathogen=${key}&page=${last}`);
      const onLast = new Set([...tail.matchAll(/href="\/investigate\/([A-Z0-9-]+)\?p=/g)].map((m) => m[1]));
      assert.equal(onLast.size, ids.size - (last - 1) * pageSize, "the final page holds the remainder");
      for (const id of onLast) assert.ok(ids.has(id), `${id} on the last page is a candidate`);
    });
  }

  it("K. pneumoniae: walking every page yields exactly the candidate set, once each", async () => {
    const ids = await candidateIds("kpneumoniae");
    const seen = [];
    for (let n = 1; n <= Math.ceil(ids.size / 24); n++) {
      const page = await html(`/investigate?pathogen=kpneumoniae&page=${n}`);
      seen.push(...new Set([...page.matchAll(/href="\/investigate\/([A-Z0-9-]+)\?p=/g)].map((m) => m[1])));
    }
    assert.equal(seen.length, new Set(seen).size, "no medicine appears twice");
    assert.deepEqual(new Set(seen), ids, "the pages together are the candidate set");
  });

  it("filters narrow the list and say by how much", async () => {
    const page = readable(await html("/investigate?pathogen=mtb&range=80-100"));
    const floor = discoveryThreshold();
    const [row] = await sql.unsafe(
      `select count(*) as n from (${candidateSql("mtb")}) c
        where c.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
                                 where p.pathogen_key = 'mtb' and p.probability >= 0.8 and p.probability <= 1)`,
      [floor],
    );
    assert.ok(page.includes(`${grouped(row.n)} of`), `shows ${row.n} matching`);
  });

  it("an unknown pathogen is not a list", async () => {
    const res = await fetch(`${BASE_URL}/investigate?pathogen=listeria`, { redirect: "manual" });
    assert.ok([307, 308].includes(res.status), "falls through to the redirect");
  });
});

describe("each dashboard pathogen card opens only that pathogen's candidates", () => {
  // Every page of the list, reached from the card's own link, must be exactly
  // the candidates predicted active (at or above the floor) against that
  // pathogen: no medicine predicted only against another pathogen, none missed.
  for (const key of PATHOGENS) {
    it(`${key}: the card's list is exactly its own candidate set`, async () => {
      const dashboard = readable(await html("/dashboard"));
      const href = `/investigate?pathogen=${key}`;
      assert.ok(dashboard.includes(`href="${href}"`), "the card links to its own pathogen");

      const ids = await candidateIds(key);
      const seen = [];
      for (let n = 1; n <= Math.max(1, Math.ceil(ids.size / 24)); n++) {
        const page = await html(`${href}&page=${n}`);
        for (const m of page.matchAll(/href="\/investigate\/([A-Z0-9-]+)\?p=([a-z]+)"/g)) {
          assert.equal(m[2], key, `${m[1]} links on with its own pathogen`);
          seen.push(m[1]);
        }
      }
      const listed = new Set(seen);
      for (const id of listed) assert.ok(ids.has(id), `${id} is predicted active against ${key}`);
      assert.deepEqual(listed, ids, "the pages together are the candidate set");

      // A medicine that is a candidate for another pathogen only never appears.
      const others = new Set();
      for (const other of PATHOGENS.filter((k) => k !== key)) {
        for (const id of await candidateIds(other)) if (!ids.has(id)) others.add(id);
      }
      for (const id of others) assert.ok(!listed.has(id), `${id} belongs to another pathogen's list`);
    });
  }

  it("the activity ranges partition each list: none counted twice", async () => {
    const counts = async (key, range) => {
      const page = readable(await html(`/investigate?pathogen=${key}${range ? `&range=${range}` : ""}`));
      const m = range ? /([\d,]+) of [\d,]+ repurposing candidates match/.exec(page) : /All ([\d,]+) repurposing candidates/.exec(page);
      assert.ok(m, `${key} ${range || "all"} shows a count`);
      return Number(m[1].replace(/,/g, ""));
    };
    for (const key of PATHOGENS) {
      const total = await counts(key, "");
      const parts = [await counts(key, "40-60"), await counts(key, "60-80"), await counts(key, "80-100")];
      assert.equal(parts.reduce((a, b) => a + b, 0), total, `${key}: ${parts.join(" + ")} = ${total}`);
    }
  });
});

describe("a condition page reconciles with its pathogen page", () => {
  // MRSA: the pathogen page lists every repurposing candidate; the "MRSA
  // infection" page lists those candidates minus the ones already documented
  // there (a registered study for the condition, or a laboratory record
  // against MRSA). Both figures, and the difference, must be stated.
  const MRSA_TERMS = ["mrsa", "methicillin-resistant", "methicillin resistant", "staphylococcus aureus", "staph aureus", "mrsa infection"];
  const padded = "(' ' || replace(lower(ct.conditions), ';', ' ') || ' ')";

  it("MRSA: all candidates = documented candidates + additional ones", async () => {
    const all = await candidateIds("mrsa");
    const documented = new Set(
      (await sql.unsafe(
        `select ct.molecule_id from clinical_trials ct
          where ct.molecule_id is not null and (${MRSA_TERMS.map((_, i) => `${padded} like $${i + 1}`).join(" or ")})
         union select b.molecule_id from bioactivity b where b.pathogen_key = 'mrsa' and b.label is not null`,
        MRSA_TERMS.map((t) => `%${t}%`),
      )).map((r) => r.molecule_id),
    );
    const overlap = [...all].filter((id) => documented.has(id)).length;
    const additional = all.size - overlap;

    const page = readable(await html("/investigate?condition=MRSA%20infection"));
    assert.ok(page.includes(`${grouped(all.size)}</span> repurposing candidates, AI-predicted`), `the pill shows all ${all.size}`);
    assert.ok(page.includes(`${grouped(additional)}</span> additional, not already listed above`), `the pill shows ${additional} additional`);
    const text = page.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    assert.ok(
      text.includes(`MRSA has ${grouped(all.size)} repurposing candidates in all. ${grouped(overlap)} ${overlap === 1 ? "is" : "are"} already listed above`),
      `the reconciliation states ${all.size} and ${overlap}`,
    );
    assert.ok(text.includes(`so the other ${grouped(additional)} are listed here`), "and the remainder");

    const pathogenPage = readable(await html("/investigate?pathogen=mrsa"));
    assert.ok(pathogenPage.includes(`All ${grouped(all.size)} repurposing candidates`), "the pathogen page shows the same total");
  });
});

describe("the molecular dataset and the medicine library stay distinct", () => {
  it("the dashboard counts the approved library, not every molecule", async () => {
    const [row] = await sql`
      select (select count(*) from molecules where is_valid)                                    as molecules,
             (select count(distinct molecule_id) from drugs where molecule_id is not null)       as library`;
    assert.ok(Number(row.molecules) > 20000, "the broad molecular dataset is kept");
    assert.ok(Number(row.library) < Number(row.molecules));
    const page = readable(await html("/dashboard"));
    assert.ok(page.includes(grouped(row.library)), "the library is shown");
    assert.ok(!page.includes(grouped(row.molecules)), "the molecular dataset is not presented as the library");
  });

  it("every library medicine has exactly four current predictions and a valid structure", async () => {
    const [row] = await sql`
      select count(*) as n from (
        select d.molecule_id from (select distinct molecule_id from drugs where molecule_id is not null) d
        left join predictions p on p.molecule_id = d.molecule_id
        left join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
        group by d.molecule_id
        having sum(case when m.model_version is not null then 1 else 0 end) <> 4) t`;
    assert.equal(Number(row.n), 0);
    const [bad] = await sql`
      select count(*) as n from molecules
       where molecule_id in (select molecule_id from drugs) and not is_valid`;
    assert.equal(Number(bad.n), 0);
  });

  it("the audit's wrong structure matches are corrected", async () => {
    const rows = await sql`
      select d.generic_name, m.pref_name from drugs d join molecules m on m.molecule_id = d.molecule_id
       where d.generic_name in ('HYDROCORTISONE', 'TESTOSTERONE', 'HYDROCORTISONE ACETATE', 'IMIPRAMINE PAMOATE')
       group by d.generic_name, m.pref_name`;
    const map = Object.fromEntries(rows.map((r) => [r.generic_name, r.pref_name]));
    assert.equal(map.HYDROCORTISONE, "HYDROCORTISONE");
    assert.equal(map.TESTOSTERONE, "TESTOSTERONE");
    assert.equal(map["HYDROCORTISONE ACETATE"], "HYDROCORTISONE ACETATE");
    assert.equal(map["IMIPRAMINE PAMOATE"], "IMIPRAMINE");
    const [nacl] = await sql`
      select count(*) as n from drugs where generic_name = 'SODIUM CHLORIDE' and molecule_id is not null`;
    assert.equal(Number(nacl.n), 0, "an inorganic salt borrows no structure");
  });
});

describe("the antimicrobial exclusion comes from classification data", () => {
  it("every medicine has been classified, and each status carries its basis", async () => {
    const [row] = await sql`
      select
        (select count(distinct molecule_id) from drugs where molecule_id is not null) as medicines,
        (select count(*) from medicine_use_status)                                    as classified,
        (select count(*) from medicine_use_status
          where status in ('antibacterial', 'other_anti_infective', 'not_anti_infective')
            and (basis is null or basis = ''))                                        as without_basis,
        (select count(*) from medicine_use_status
          where status = 'antibacterial'
            and basis not like '%WHO ATC J0%' and basis not like '%WHO ATC D06%'
            and basis not like '%WHO ATC S01A%' and basis not like '%WHO ATC A07AA%'
            and basis not like '%WHO ATC G01AA%' and basis not like '%WHO ATC R02AB%'
            and basis not like '%WHO ATC D10AF%' and basis not like '%FDA class%')    as off_rule`;
    assert.equal(Number(row.classified), Number(row.medicines), "one status per medicine");
    const [flag] = await sql`
      select count(*) as n from medicine_use_status
       where (status = 'antibacterial') <> (is_antibacterial = 'true')
          or (status = 'unclassified') <> (is_antibacterial = 'unclassified')`;
    assert.equal(Number(flag.n), 0, "is_antibacterial agrees with the status; unclassified is never false");
    assert.equal(Number(row.without_basis), 0, "a classification names the codes that decided it");
    assert.equal(Number(row.off_rule), 0, "every antibacterial is decided by an ATC group or FDA class in the rule");
  });

  it("known repurposing examples stay candidates; known antibiotics do not", async () => {
    const status = async (name) => {
      const [r] = await sql`
        select us.status from medicine_use_status us join drugs d on d.molecule_id = us.molecule_id
         where lower(d.generic_name) = ${name} limit 1`;
      return r?.status;
    };
    for (const name of ["ciprofloxacin", "doxycycline", "levofloxacin", "vancomycin", "rifampin", "isoniazid"]) {
      assert.equal(await status(name), "antibacterial", `${name} is an existing antibacterial`);
    }
    for (const name of ["sertraline", "tamoxifen citrate", "metformin hydrochloride", "levoketoconazole"]) {
      const s = await status(name);
      if (s !== undefined) assert.notEqual(s, "antibacterial", `${name} is not an antibacterial`);
    }
    assert.equal(await status("amphotericin b"), "other_anti_infective", "a polyene antifungal is not an antibacterial");
  });
});

describe("the medicine view shows its existing use first", () => {
  it("existing use, then why it is here, then its AI-predicted activity, then evidence", async () => {
    const [row] = await sql.unsafe(
      `select c.molecule_id from (${candidateSql("mtb")}) c
         join medicine_indications mi on mi.molecule_id = c.molecule_id limit 1`,
      [discoveryThreshold()],
    );
    const page = readable(await html(`/investigate/${row.molecule_id}?p=mtb`));
    const order = [
      "Existing / approved use",
      "Repurposing investigation",
      "being investigated here for AI-predicted antimicrobial activity against",
      'id="activity"',
      'id="evidence"',
      'id="studies"',
    ].map((marker) => page.indexOf(marker));
    assert.ok(order.every((i) => i > 0), `all sections present: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "sections appear in the required order");
    assert.ok(/Approved for/.test(page), "the approved indications are listed");
    assert.ok(/M\. tuberculosis/.test(page.slice(order[2], order[3])), "names the pathogen it was surfaced for");
  });

  it("an existing antibacterial says it is not a repurposing candidate", async () => {
    const [row] = await sql`
      select d.molecule_id from drugs d join medicine_use_status us on us.molecule_id = d.molecule_id
       where us.status = 'antibacterial' and lower(d.generic_name) = 'ciprofloxacin' limit 1`;
    const page = readable(await html(`/investigate/${row.molecule_id}`));
    assert.ok(/already an antimicrobial, so it is not counted among the repurposing/.test(page));
    assert.ok(!/being investigated here for AI-predicted antimicrobial activity/.test(page));
  });
});

describe("the downloads are the site's own data", () => {
  it("approved medicines: the complete library, one row per medicine", async () => {
    const [row] = await sql`
      select count(distinct molecule_id) as n from drugs where molecule_id is not null`;
    const { header, rows } = await csv("/api/export/approved-medicines");
    assert.equal(rows.length, Number(row.n), `${row.n} medicines`);
    const key = header.indexOf("InChIKey");
    assert.ok(key >= 0);
    assert.equal(new Set(rows.map((r) => r[key])).size, rows.length, "no medicine twice");
    for (const k of ["MRSA", "E. coli", "K. pneumoniae", "M. tuberculosis"]) {
      assert.ok(header.includes(`AI-predicted activity: ${k} (%)`), `has the ${k} prediction column`);
    }
    assert.ok(header.includes("Existing / approved use") && header.includes("Anti-infective classification"));
    const cls = header.indexOf("Anti-infective classification");
    assert.ok(rows.some((r) => r[cls] === "Existing antimicrobial"), "antimicrobials are kept in the library");
  });

  it("repurposing candidates: exactly the dashboard's population, and per pathogen", async () => {
    const ids = await candidateIds();
    const { header, rows } = await csv("/api/export/repurposing-candidates");
    const key = header.indexOf("InChIKey");
    const got = rows.map((r) => r[key]);
    assert.equal(got.length, ids.size, `${ids.size} candidates`);
    assert.equal(new Set(got).size, got.length, "no medicine twice");
    assert.deepEqual(new Set(got), ids, "the same medicines as the database definition");
    const cls = header.indexOf("Anti-infective classification");
    assert.ok(!rows.some((r) => r[cls] === "Existing antimicrobial"), "no existing antimicrobial");

    const dashboard = readable(await html("/dashboard"));
    assert.ok(dashboard.includes(`${grouped(ids.size)} rows`), "the download is labelled with the dashboard count");

    for (const k of PATHOGENS) {
      const want = await candidateIds(k);
      const part = await csv(`/api/export/repurposing-candidates?pathogen=${k}`);
      assert.deepEqual(new Set(part.rows.map((r) => r[key])), want, `${k} export matches its list`);
    }
  });

  it("contain public research data only", async () => {
    const env = readEnv();
    const secrets = [env.DATABASE_URL, env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]
      .filter(Boolean);
    let password = null;
    try { password = decodeURIComponent(new URL(env.DATABASE_URL).password) || null; } catch {}
    for (const route of ["/api/export/approved-medicines", "/api/export/repurposing-candidates"]) {
      const { text, header } = await csv(route);
      for (const s of secrets) assert.ok(!text.includes(s), `${route} must not contain a credential`);
      if (password) assert.ok(!text.includes(password), `${route} must not contain the database password`);
      for (const pattern of [/postgres(ql)?:\/\//i, /supabase/i, /RF-(mrsa|ecoli|kpneumoniae|mtb)-v\d/, /DS-20\d{6}/, /drug_id|dataset_version|model_version/]) {
        assert.ok(!pattern.test(text), `${route} must not contain ${pattern}`);
      }
      assert.ok(!header.some((h) => /effective|efficacy|cure|treatment/i.test(h)), "no clinical-benefit column names");
      assert.ok(!/^[=+\-@]/m.test(text.replace(/^\uFEFF/, "")), "no cell can run as a spreadsheet formula");
    }
    const bad = await fetch(`${BASE_URL}/api/export/repurposing-candidates?pathogen=zzz`);
    assert.equal(bad.status, 400);
  });
});

const PUBLIC_ROUTES = [
  "/",
  "/dashboard",
  "/dashboard?sc=tuberculosis",
  "/investigate/XMAYWYJOQHXEEK-ZEQKJWHPSA-N",
  "/investigate?condition=Tuberculosis",
  "/investigate?condition=Migraine",
  "/investigate?medicine=cipro",
  "/investigate?pathogen=mrsa",
  "/investigate?pathogen=ecoli",
  "/investigate?pathogen=kpneumoniae",
  "/investigate?pathogen=mtb",
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
    /effective (drug|medicine)s/i,
    /recommended (drug|medicine)s/i,
    /treatment probability/i,
    /most effective/i,
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
