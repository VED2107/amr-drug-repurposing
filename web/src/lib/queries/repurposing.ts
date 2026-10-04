import "server-only";

/**
 * The repurposing population, defined once.
 *
 *   approved medicines (the library, never filtered)
 *     → a valid structure and a prediction from each current model
 *     → AI-predicted activity at or above the discovery floor for ≥1 pathogen
 *     → minus medicines that are already antibacterials
 *     = repurposing candidates
 *
 * Every count, list and export of repurposing candidates on the site is built
 * from `candidateFilter` below: the dashboard figures, the pathogen lists, the
 * condition view's "other medicines to investigate" and both CSV files. A
 * second definition anywhere would let a page and a download disagree.
 *
 * Whether a medicine is already an antibacterial is not decided here. It is
 * read from `medicine_use_status`, which the research pipeline fills from WHO
 * ATC codes and FDA pharmacologic classes (`src/ingestion/classification.py`).
 * A medicine that no source classifies is kept, and marked, never removed.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import { ONE_PER_MEDICINE } from "@/lib/queries/investigate";
import { DISCOVERY_THRESHOLD } from "@/lib/science";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";
import type { ExistingUse, UseStatus } from "@/lib/existing-use";

export { existingUseText, type ExistingUse, type UseStatus } from "@/lib/existing-use";

/**
 * A candidate must be classified as NOT an antibacterial (`is_antibacterial =
 * 'false'`). Existing antibacterials are excluded; antifungals, antivirals,
 * antiparasitics and every other medicine stay. A medicine no source could
 * classify is not assumed to be a non-antibacterial: it stays in the library,
 * marked "needs review", and is not counted as a candidate.
 */
export const CANDIDATE_ANTIBACTERIAL_FLAG = "false";

const ACTIVE = "join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'";

export type EvidenceFilter = "lab" | "studies" | "none";

export interface CandidateFilterOptions {
  /** Only medicines at or above the floor for this pathogen. Else: for any. */
  pathogenKey?: PathogenKey;
  /** Remove one medicine (the one being investigated). */
  exclude?: string;
  /** Remove a set of medicines, as a SQL subquery over molecule_id. */
  excludeWhere?: { sql: string; params: (string | number)[] };
  /** Medicine name contains. */
  name?: string;
  /** Existing / approved use contains. */
  use?: string;
  /** Activity range for `pathogenKey`, as fractions. */
  min?: number;
  max?: number;
  evidence?: EvidenceFilter;
}

/**
 * The one definition of a repurposing candidate, as SQL over `one` (one product
 * row per medicine, see `ONE_PER_MEDICINE`).
 */
export function candidateFilter(options: CandidateFilterOptions = {}): {
  sql: string;
  params: (string | number)[];
} {
  const where: string[] = [];
  const params: (string | number)[] = [];

  where.push(
    `one.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
       where p.probability >= ?${options.pathogenKey ? " and p.pathogen_key = ?" : ""})`,
  );
  params.push(DISCOVERY_THRESHOLD);
  if (options.pathogenKey) params.push(options.pathogenKey);

  // A candidate needs a reliable structure: a prediction is only as good as
  // the molecule it was computed for.
  where.push(
    `one.molecule_id in (select molecule_id from molecules where is_valid)`,
  );

  where.push(
    `one.molecule_id in (select molecule_id from medicine_use_status where is_antibacterial = ?)`,
  );
  params.push(CANDIDATE_ANTIBACTERIAL_FLAG);

  if (options.exclude) {
    where.push("one.molecule_id <> ?");
    params.push(options.exclude);
  }
  if (options.excludeWhere) {
    where.push(`one.molecule_id not in (${options.excludeWhere.sql})`);
    params.push(...options.excludeWhere.params);
  }
  const name = likeText(options.name);
  if (name) {
    // A combination product's brand sits on every ingredient's row, so it is
    // not matched: "aspirin" must not bring up butalbital.
    where.push(
      `one.molecule_id in (select molecule_id from drugs
         where lower(generic_name) like ?
            or (lower(coalesce(brand_name, '')) like ?
                and coalesce(match_method, '') not like 'combination%'))`,
    );
    params.push(name, name);
  }
  const use = likeText(options.use);
  if (use) {
    where.push(
      `(one.molecule_id in (select molecule_id from medicine_indications where lower(indication) like ?)
        or one.molecule_id in (select molecule_id from medicine_classes
             where lower(coalesce(name, '')) like ? or lower(coalesce(group_name, '')) like ?
                or lower(coalesce(therapeutic_group, '')) like ?))`,
    );
    params.push(use, use, use, use);
  }
  if (options.pathogenKey && (options.min !== undefined || options.max !== undefined)) {
    where.push(
      `one.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
         where p.pathogen_key = ? and p.probability >= ? and p.probability <= ?)`,
    );
    params.push(options.pathogenKey, options.min ?? 0, options.max ?? 1);
  }
  if (options.evidence) {
    const lab = options.pathogenKey
      ? { sql: "select molecule_id from bioactivity where label is not null and pathogen_key = ?", params: [options.pathogenKey] }
      : { sql: "select molecule_id from bioactivity where label is not null", params: [] };
    const studies = "select molecule_id from clinical_trials where molecule_id is not null";
    if (options.evidence === "lab") {
      where.push(`one.molecule_id in (${lab.sql})`);
      params.push(...lab.params);
    } else if (options.evidence === "studies") {
      where.push(`one.molecule_id in (${studies})`);
    } else {
      where.push(`one.molecule_id not in (${lab.sql}) and one.molecule_id not in (${studies})`);
      params.push(...lab.params);
    }
  }

  return { sql: where.join(" and "), params };
}

function likeText(text: string | undefined): string | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase().replace(/[%_]/g, " ").replace(/\s+/g, " ");
  return clean.length >= 2 ? `%${clean}%` : null;
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

export interface RepurposingSummary {
  /** Distinct medicines in the approved library. */
  medicines: number;
  /** Distinct medicines at or above the floor for at least one pathogen. */
  withActivity: number;
  /** Of those, how many are existing antibacterials and were set aside. */
  existingAntibacterials: number;
  /** Of those, how many no source could classify (or not yet checked): needs review. */
  needsReview: number;
  /** withActivity − existingAntibacterials − needsReview. */
  candidates: number;
  /** Medicines whose classification has not been looked up at all. */
  notYetClassified: number;
  registeredStudies: number;
  pathogens: {
    key: PathogenKey;
    label: string;
    fullName: string;
    withActivity: number;
    existingAntibacterials: number;
    needsReview: number;
    candidates: number;
  }[];
}

export async function getRepurposingSummary(): Promise<RepurposingSummary> {
  const all = candidateFilter();
  const floor = `one.molecule_id in (select p.molecule_id from predictions p ${ACTIVE} where p.probability >= ?)`;
  const row = await queryOne<Record<string, unknown>>(
    `select
       (select count(*) from ${ONE_PER_MEDICINE} one)                          as medicines,
       (select count(*) from ${ONE_PER_MEDICINE} one where ${floor})           as with_activity,
       (select count(*) from ${ONE_PER_MEDICINE} one where ${all.sql})         as candidates,
       (select count(*) from ${ONE_PER_MEDICINE} one where ${floor}
          and one.molecule_id in (select molecule_id from medicine_use_status
                                   where is_antibacterial = 'true'))            as antibacterial,
       (select count(*) from ${ONE_PER_MEDICINE} one
         where one.molecule_id not in (select molecule_id from medicine_use_status)) as not_classified,
       (select count(distinct nct_id) from clinical_trials)                    as studies`,
    [DISCOVERY_THRESHOLD, ...all.params, DISCOVERY_THRESHOLD],
  );
  if (!row) throw new Error("repurposing summary returned no row");

  const pathogens = await query<Record<string, unknown>>(`select key, label, full_name from pathogens`);
  const per = await Promise.all(
    PATHOGEN_KEYS.map(async (key) => {
      const f = candidateFilter({ pathogenKey: key });
      const r = await queryOne<Record<string, unknown>>(
        `select
           (select count(*) from ${ONE_PER_MEDICINE} one
             where one.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
                                        where p.probability >= ? and p.pathogen_key = ?)) as with_activity,
           (select count(*) from ${ONE_PER_MEDICINE} one where ${f.sql})                 as candidates,
           (select count(*) from ${ONE_PER_MEDICINE} one
             where one.molecule_id in (select p.molecule_id from predictions p ${ACTIVE}
                                        where p.probability >= ? and p.pathogen_key = ?)
               and one.molecule_id in (select molecule_id from medicine_use_status
                                        where is_antibacterial = 'true'))                 as antibacterial`,
        [DISCOVERY_THRESHOLD, key, ...f.params, DISCOVERY_THRESHOLD, key],
      );
      const p = pathogens.find((x) => String(x.key) === key);
      const withActivity = toNum(r?.with_activity) ?? 0;
      const candidates = toNum(r?.candidates) ?? 0;
      const existingAntibacterials = toNum(r?.antibacterial) ?? 0;
      return {
        key,
        label: p ? String(p.label) : key,
        fullName: p ? String(p.full_name) : key,
        withActivity,
        existingAntibacterials,
        needsReview: withActivity - candidates - existingAntibacterials,
        candidates,
      };
    }),
  );

  const withActivity = toNum(row.with_activity) ?? 0;
  const candidates = toNum(row.candidates) ?? 0;
  const existingAntibacterials = toNum(row.antibacterial) ?? 0;
  return {
    medicines: toNum(row.medicines) ?? 0,
    withActivity,
    existingAntibacterials,
    needsReview: withActivity - candidates - existingAntibacterials,
    candidates,
    notYetClassified: toNum(row.not_classified) ?? 0,
    registeredStudies: toNum(row.studies) ?? 0,
    pathogens: per,
  };
}

/* ------------------------------------------------------------------ */
/* Existing use                                                        */
/* ------------------------------------------------------------------ */

/** Existing use for many medicines at once, keyed by molecule id. */
export async function getExistingUse(moleculeIds: string[] | "all"): Promise<Map<string, ExistingUse>> {
  const out = new Map<string, ExistingUse>();
  const ids = moleculeIds === "all" ? null : [...new Set(moleculeIds)];
  if (ids && ids.length === 0) return out;
  const scope = ids ? `where molecule_id in (${ids.map(() => "?").join(", ")})` : "";
  const params = ids ?? [];

  const [statuses, indications, classes] = await Promise.all([
    query<Record<string, unknown>>(
      `select molecule_id, status, basis, fda_label_set_id from medicine_use_status ${scope}`,
      params,
    ),
    query<Record<string, unknown>>(
      `select molecule_id, indication, ref_url from medicine_indications ${scope}
        order by molecule_id, indication`,
      params,
    ),
    query<Record<string, unknown>>(
      `select molecule_id, system, code, name, group_name from medicine_classes ${scope}
        order by molecule_id, system desc, code`,
      params,
    ),
  ]);

  const entry = (id: string): ExistingUse => {
    let e = out.get(id);
    if (!e) {
      e = {
        status: null,
        basis: null,
        indications: [],
        indicationSource: null,
        atcGroups: [],
        fdaClasses: [],
        labelSetId: null,
      };
      out.set(id, e);
    }
    return e;
  };
  for (const r of statuses) {
    const e = entry(String(r.molecule_id));
    e.status = String(r.status) as UseStatus;
    e.basis = r.basis == null ? null : String(r.basis);
    e.labelSetId = r.fda_label_set_id == null ? null : String(r.fda_label_set_id);
  }
  for (const r of indications) {
    const e = entry(String(r.molecule_id));
    e.indications.push(String(r.indication));
    if (!e.indicationSource && r.ref_url) e.indicationSource = String(r.ref_url);
  }
  for (const r of classes) {
    const e = entry(String(r.molecule_id));
    if (r.system === "WHO ATC") {
      const group = r.group_name == null ? null : String(r.group_name);
      if (group && !e.atcGroups.includes(group)) e.atcGroups.push(group);
    } else if (r.name) {
      e.fdaClasses.push(String(r.name));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export interface RepurposingRow {
  moleculeId: string;
  name: string;
  /** Probability for the listed pathogen. */
  probability: number;
  labRecords: number;
  studies: number;
  hasStructure: boolean;
  use: ExistingUse | undefined;
}

export interface RepurposingPage {
  pathogenKey: PathogenKey;
  rows: RepurposingRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Repurposing candidates for one pathogen, sorted by AI-predicted activity.
 * The order is for reading; the page says it is not a ranking.
 */
export async function getRepurposingCandidates(
  options: CandidateFilterOptions & { pathogenKey: PathogenKey; page?: number; pageSize?: number },
): Promise<RepurposingPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = options.pageSize ?? 12;
  const f = candidateFilter(options);

  const [count, rows] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `select count(*) as n from ${ONE_PER_MEDICINE} one where ${f.sql}`,
      f.params,
    ),
    query<Record<string, unknown>>(
      `select d.molecule_id, d.generic_name, p.probability,
              (select count(*) from bioactivity b
                where b.molecule_id = d.molecule_id and b.pathogen_key = ? and b.label is not null) as lab,
              (select count(distinct ct.nct_id) from clinical_trials ct
                where ct.molecule_id = d.molecule_id) as studies,
              case when exists (select 1 from molecules mo
                where mo.molecule_id = d.molecule_id and mo.is_valid) then 1 else 0 end as has_structure
         from ${ONE_PER_MEDICINE} one
         join drugs d on d.drug_id = one.drug_id
         join predictions p on p.molecule_id = one.molecule_id and p.pathogen_key = ?
         ${ACTIVE}
        where ${f.sql}
        order by p.probability desc, d.generic_name asc
        limit ? offset ?`,
      [options.pathogenKey, options.pathogenKey, ...f.params, pageSize, (page - 1) * pageSize],
    ),
  ]);

  const uses = await getExistingUse(rows.map((r) => String(r.molecule_id)));
  return {
    pathogenKey: options.pathogenKey,
    total: toNum(count?.n) ?? 0,
    page,
    pageSize,
    rows: rows.map((r) => ({
      moleculeId: String(r.molecule_id),
      name: String(r.generic_name),
      probability: toNum(r.probability) as number,
      labRecords: toNum(r.lab) ?? 0,
      studies: toNum(r.studies) ?? 0,
      hasStructure: Number(r.has_structure) === 1,
      use: uses.get(String(r.molecule_id)),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export interface LibraryRecord {
  moleculeId: string;
  name: string;
  brandNames: string[];
  chemblId: string | null;
  applications: string[];
  firstApproval: string | null;
  hasStructure: boolean;
  predictions: Partial<Record<PathogenKey, number>>;
  labRecords: number;
  registryChecked: boolean;
  studies: number;
  use: ExistingUse | undefined;
  /** Whether it is in the repurposing candidates, by `candidateFilter`. */
  isCandidate: boolean;
}

/**
 * Every medicine in the approved library, one record each, with the facts both
 * exports publish. `isCandidate` comes from `candidateFilter`, so the
 * candidate export is exactly the dashboard's population.
 */
export async function getLibraryRecords(): Promise<LibraryRecord[]> {
  const cand = candidateFilter();
  const [meds, products, preds, lab, studies, checked, candidates, uses] = await Promise.all([
    query<Record<string, unknown>>(
      `select d.molecule_id, d.generic_name, d.chembl_id,
              case when exists (select 1 from molecules mo
                where mo.molecule_id = d.molecule_id and mo.is_valid) then 1 else 0 end as has_structure
         from ${ONE_PER_MEDICINE} one join drugs d on d.drug_id = one.drug_id
        order by d.generic_name`,
    ),
    query<Record<string, unknown>>(
      `select molecule_id, brand_name, application_type, application_no, approval_date
         from drugs where molecule_id is not null`,
    ),
    query<Record<string, unknown>>(
      `select p.molecule_id, p.pathogen_key, p.probability from predictions p ${ACTIVE}`,
    ),
    query<Record<string, unknown>>(
      `select molecule_id, count(*) as n from bioactivity where label is not null group by molecule_id`,
    ),
    query<Record<string, unknown>>(
      `select molecule_id, count(distinct nct_id) as n from clinical_trials
        where molecule_id is not null group by molecule_id`,
    ),
    query<Record<string, unknown>>(`select molecule_id from clinical_queries where status = 'ok'`),
    query<Record<string, unknown>>(
      `select one.molecule_id from ${ONE_PER_MEDICINE} one where ${cand.sql}`,
      cand.params,
    ),
    getExistingUse("all"),
  ]);

  const byMol = <T>(rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => T) =>
    new Map(rows.map((r) => [String(r.molecule_id), f(r)]));
  const labN = byMol(lab, (r) => toNum(r.n) ?? 0);
  const studyN = byMol(studies, (r) => toNum(r.n) ?? 0);
  const checkedSet = new Set(checked.map((r) => String(r.molecule_id)));
  const candSet = new Set(candidates.map((r) => String(r.molecule_id)));

  const predMap = new Map<string, Partial<Record<PathogenKey, number>>>();
  for (const r of preds) {
    const id = String(r.molecule_id);
    const m = predMap.get(id) ?? {};
    m[String(r.pathogen_key) as PathogenKey] = toNum(r.probability) as number;
    predMap.set(id, m);
  }

  const prod = new Map<string, { brands: Set<string>; apps: Set<string>; first: { date: number; text: string } | null }>();
  for (const r of products) {
    const id = String(r.molecule_id);
    const e = prod.get(id) ?? { brands: new Set<string>(), apps: new Set<string>(), first: null };
    if (r.brand_name) e.brands.add(String(r.brand_name));
    if (r.application_no) e.apps.add(`${r.application_type === "N" ? "NDA" : "ANDA"}${r.application_no}`);
    const text = r.approval_date == null ? null : String(r.approval_date);
    const t = text ? Date.parse(text) : NaN;
    if (text && Number.isFinite(t) && (!e.first || t < e.first.date)) e.first = { date: t, text };
    prod.set(id, e);
  }

  return meds.map((r) => {
    const id = String(r.molecule_id);
    const p = prod.get(id);
    return {
      moleculeId: id,
      name: String(r.generic_name),
      brandNames: p ? [...p.brands].sort() : [],
      chemblId: r.chembl_id == null ? null : String(r.chembl_id),
      applications: p ? [...p.apps].sort() : [],
      firstApproval: p?.first ? new Date(p.first.date).toISOString().slice(0, 10) : null,
      hasStructure: Number(r.has_structure) === 1,
      predictions: predMap.get(id) ?? {},
      labRecords: labN.get(id) ?? 0,
      registryChecked: checkedSet.has(id),
      studies: studyN.get(id) ?? 0,
      use: uses.get(id),
      isCandidate: candSet.has(id),
    };
  });
}
