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
    connection: { search_path: "amr,public" },
  });
});

after(async () => {
  await sql?.end();
});

/** Digits as the interface groups them: 1691 → "1,691". */
const grouped = (value) => Number(value).toLocaleString("en-GB");

async function html(route) {
  const res = await fetch(`${BASE_URL}${route}`);
  assert.equal(res.status, 200, `${route} should render`);
  return res.text();
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

describe("the dashboard reports live counts", () => {
  it("shows the library, structure and study counts the database holds", async () => {
    const [row] = await sql`
      select
        (select count(distinct molecule_id) from drugs where molecule_id is not null) as medicines,
        (select count(*) from molecules where is_valid)                               as structures,
        (select count(distinct nct_id) from clinical_trials)                          as studies,
        (select count(*) from docking_results where status = 'ok')                    as poses`;

    const page = await html("/dashboard");
    for (const [label, value] of Object.entries(row)) {
      assert.ok(
        page.includes(grouped(value)),
        `dashboard should show the live ${label} count (${grouped(value)})`,
      );
    }
  });
});

describe("the case study reads its identifiers from the database", () => {
  it("shows the stored InChIKey, ChEMBL id, docking score and target", async () => {
    const [drug] = await sql`
      select d.molecule_id, d.chembl_id from drugs d
       where lower(d.generic_name) = 'levoketoconazole' limit 1`;
    assert.ok(drug, "the case-study subject must exist in the database");

    const [pose] = await sql`
      select min(score_kcal_mol) as best from docking_results
       where molecule_id = ${drug.molecule_id} and status = 'ok'`;
    const [target] = await sql`
      select pdb_id from targets where target_key = 'mtb_inha'`;

    const page = await html("/case-study");
    assert.ok(page.includes(drug.molecule_id), "shows the stored InChIKey");
    assert.ok(page.includes(drug.chembl_id), "shows the stored ChEMBL id");
    assert.ok(page.includes(Number(pose.best).toFixed(3)), "shows the stored docking score");
    assert.ok(page.includes(target.pdb_id), "shows the PDB the pose was computed against");
  });

  it("does not carry the identifiers the design project got wrong", async () => {
    const page = await html("/case-study");
    // CHEMBL4297516 is Lurbinectedin, an unrelated medicine; the design file
    // carries it for this subject. The database is authoritative.
    assert.ok(!page.includes("CHEMBL4297516"), "must not use the design project's ChEMBL id");
    assert.ok(
      !page.includes("DCUFMVPCXCSVNP-XKDAHURESA-N"),
      "must not use the design project's InChIKey",
    );
  });

  it("states that it is retrospective rather than a discovery", async () => {
    const page = await html("/case-study");
    assert.ok(
      /retrospective computational case study/i.test(page),
      "the caveat must be on the page",
    );
    assert.ok(/not a held-out discovery/i.test(page));
  });
});

describe("the percentage gate holds in the rendered pages", () => {
  it("shows no probability for a condition with no model", async () => {
    const page = await html("/explorer?medicine=levoketoconazole&condition=Cushing%27s%20Syndrome");
    assert.ok(
      /No model exists for this condition/i.test(page),
      "an unmodelled condition must say so explicitly",
    );
    // The activity figure for this medicine's mtb model must not leak into a
    // page about an endocrine condition.
    assert.ok(!/AI-predicted activity<\/span>\s*<\/div>\s*<span[^>]*>8[0-9]%/.test(page));
  });

  it("shows the stored probability for a condition that has a model", async () => {
    const [row] = await sql`
      select p.probability from predictions p
       join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
       join drugs d on d.molecule_id = p.molecule_id
      where lower(d.generic_name) = 'levoketoconazole' and p.pathogen_key = 'mtb' limit 1`;

    const expected =
      Number(row.probability) >= 0.995
        ? ">99%"
        : `${Math.round(Number(row.probability) * 100)}%`;

    const page = await html("/explorer?medicine=levoketoconazole&condition=Tuberculosis");
    assert.ok(page.includes(expected), `explorer should show ${expected}`);
  });

  it("renders a saturated probability as >99% rather than 100%", async () => {
    const [row] = await sql`
      select count(*) as n from predictions p
       join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
      where p.probability >= 0.995`;
    if (Number(row.n) === 0) return; // nothing saturated in this snapshot

    const page = await html("/screening?pathogen=kpneumoniae&sort=probability&dir=desc");
    assert.ok(page.includes("&gt;99%") || page.includes(">99%"), "saturation must read >99%");
    assert.ok(!/>100%</.test(page), "no probability may be rendered as 100%");
  });
});

describe("coverage is reported as coverage, not as evidence", () => {
  it("clinical page matches the query counts in the database", async () => {
    const [row] = await sql`
      select
        (select count(*) from clinical_queries)                     as queried,
        (select count(*) from clinical_queries where n_results = 0) as none_found,
        (select count(distinct nct_id) from clinical_trials)        as studies`;

    const page = await html("/clinical");
    assert.ok(page.includes(grouped(row.queried)), "shows how many medicines were queried");
    assert.ok(page.includes(grouped(row.none_found)), "shows how many returned nothing");
    assert.ok(page.includes(grouped(row.studies)), "shows the distinct study count");
    assert.ok(/not yet checked/i.test(page) && /no evidence found/i.test(page));
  });

  it("docking page matches the pose counts in the database", async () => {
    const [row] = await sql`
      select
        (select count(*) from docking_results where status = 'ok')          as poses,
        (select count(distinct molecule_id) from docking_results
          where status = 'ok')                                              as molecules`;

    const page = await html("/docking");
    assert.ok(page.includes(grouped(row.poses)), "shows the stored pose count");
    assert.ok(page.includes(grouped(row.molecules)), "shows how many medicines are docked");
    assert.ok(/not yet docked/i.test(page), "must name the uncomputed remainder");
  });
});

describe("no page claims clinical benefit", () => {
  const FORBIDDEN = [
    /\d+\s*%\s*(effective|efficacy|success|cure)/i,
    /proven to treat/i,
    /clinically effective/i,
    /recommended for treatment/i,
  ];

  for (const route of [
    "/",
    "/dashboard",
    "/screening",
    "/candidates",
    "/medicines",
    "/case-study",
    "/explorer?medicine=levoketoconazole&condition=Tuberculosis",
    "/molecular",
    "/docking",
    "/clinical",
    "/models",
    "/pipeline",
    "/retraining",
    "/runs",
    "/roadmap",
  ]) {
    it(`${route} carries no efficacy language`, async () => {
      const page = await html(route);
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(page), `${route} must not match ${pattern}`);
      }
    });
  }
});
