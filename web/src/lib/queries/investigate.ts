import "server-only";

/**
 * Every query behind the dashboard and the investigation view.
 *
 * Two rules run through all of it:
 *
 * - A medicine is counted once. `drugs` holds one row per approved product, so
 *   one structure (one `molecule_id`) is chosen per medicine before anything is
 *   counted or listed. Predictions are read only from ACTIVE models, which hold
 *   exactly one prediction per medicine and pathogen.
 * - Repurposing candidates — counts, lists and exports — are defined once, in
 *   `repurposing.ts`. Nothing here counts them.
 *
 * The SQL is the subset SQLite and Postgres both accept; see `db/client.ts`.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import { pathogenConditionTerms } from "@/lib/science";
import type { PathogenKey } from "@/lib/types";

/**
 * One product row per medicine: the structure is the medicine's identity.
 *
 * The row chosen is the one with the shortest generic name, so a medicine is
 * called "Ciprofloxacin" everywhere rather than "Ciprofloxacin Hydrochloride"
 * in one list and "Ciprofloxacin" on its own page. `getMedicineByMoleculeId`
 * uses the same order.
 */
export const ONE_PER_MEDICINE = `(
  select molecule_id, drug_id from (
    select molecule_id, drug_id,
           row_number() over (
             partition by molecule_id
             order by case when coalesce(match_method, '') like 'combination%' then 1 else 0 end,
                      length(generic_name), generic_name, drug_id
           ) as pick
      from drugs where molecule_id is not null
  ) ranked where pick = 1
)`;

/* ------------------------------------------------------------------ */
/* Medicine lookup                                                     */
/* ------------------------------------------------------------------ */

export interface MedicineHit {
  /** Null for a product the pipeline could not match to a structure. */
  moleculeId: string | null;
  name: string;
  note: string;
  href: string;
}

function hitFor(row: Record<string, unknown>): MedicineHit {
  const name = String(row.generic_name);
  const moleculeId = row.molecule_id == null ? null : String(row.molecule_id);
  return {
    moleculeId,
    name,
    note: moleculeId
      ? row.brand_name
        ? String(row.brand_name)
        : "Approved medicine"
      : "No usable structure, so no AI prediction",
    href: moleculeId
      ? `/investigate/${encodeURIComponent(moleculeId)}`
      : `/investigate?medicine=${encodeURIComponent(name)}`,
  };
}

/**
 * Medicines whose generic or brand name contains the term.
 *
 * Products with no structure are included: a reader who searches for one is
 * owed "this medicine is here but could not be screened", not silence.
 */
export async function searchMedicines(term: string, limit = 8): Promise<MedicineHit[]> {
  const needle = likeNeedle(term);
  if (!needle) return [];
  const rows = await query<Record<string, unknown>>(
    `select molecule_id, generic_name, brand_name from (
       select d.molecule_id, d.generic_name, d.brand_name
         from ${ONE_PER_MEDICINE} one
         join drugs d on d.drug_id = one.drug_id
        where one.molecule_id in (
          select molecule_id from drugs
           where lower(generic_name) like ? or lower(coalesce(brand_name, '')) like ?)
       union
       select null as molecule_id, min(generic_name) as generic_name, null as brand_name
         from drugs
        where molecule_id is null and lower(generic_name) like ?
        group by lower(generic_name)
     ) hits
     order by case when lower(generic_name) like ? then 0 else 1 end,
              length(generic_name), generic_name
     limit ?`,
    [needle, needle, needle, `${needle.slice(1)}`, limit],
  );
  return rows.map(hitFor);
}

export type MedicineResolution =
  | { kind: "found"; moleculeId: string }
  | { kind: "unscreened"; name: string; products: number }
  | { kind: "matches"; hits: MedicineHit[] };

/** A typed name → the medicine it names, or the medicines it could mean. */
export async function resolveMedicine(text: string): Promise<MedicineResolution> {
  const exact = text.trim().toLowerCase();
  if (exact) {
    const found = await queryOne<Record<string, unknown>>(
      `select molecule_id from drugs
        where molecule_id is not null
          and (lower(generic_name) = ? or lower(coalesce(brand_name, '')) = ?)
        order by drug_id limit 1`,
      [exact, exact],
    );
    if (found?.molecule_id) return { kind: "found", moleculeId: String(found.molecule_id) };

    const unscreened = await queryOne<Record<string, unknown>>(
      `select min(generic_name) as name, count(*) as n from drugs
        where molecule_id is null and lower(generic_name) = ?`,
      [exact],
    );
    if (unscreened && (toNum(unscreened.n) ?? 0) > 0) {
      return {
        kind: "unscreened",
        name: String(unscreened.name),
        products: toNum(unscreened.n) ?? 0,
      };
    }
  }
  return { kind: "matches", hits: await searchMedicines(text, 30) };
}

/* ------------------------------------------------------------------ */
/* Medicine detail                                                     */
/* ------------------------------------------------------------------ */

export interface BestDocking {
  pathogenKey: PathogenKey;
  targetName: string;
  pdbId: string | null;
  scoreKcalMol: number;
}

/** The best stored pose per pathogen, with the target it was computed against. */
export async function getBestDocking(moleculeId: string): Promise<BestDocking[]> {
  const rows = await query<Record<string, unknown>>(
    `select dr.pathogen_key, t.name as target_name, t.pdb_id, min(dr.score_kcal_mol) as best
       from docking_results dr
       join targets t on t.target_key = dr.target_key
      where dr.molecule_id = ? and dr.status = 'ok' and dr.score_kcal_mol is not null
      group by dr.pathogen_key, t.name, t.pdb_id`,
    [moleculeId],
  );
  return rows.map((r) => ({
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    targetName: String(r.target_name),
    pdbId: r.pdb_id == null ? null : String(r.pdb_id),
    scoreKcalMol: toNum(r.best) as number,
  }));
}

export interface LabRecord {
  pathogenKey: PathogenKey;
  assayId: string | null;
  assayDescription: string | null;
  activityType: string | null;
  relation: string | null;
  value: number | null;
  units: string | null;
  /** 1 measured active, 0 measured inactive, at the project's labelling cutoff. */
  label: number;
  documentId: string | null;
  year: number | null;
}

/**
 * Labelled laboratory records for one medicine, each traceable to its ChEMBL
 * assay and source publication.
 */
export async function getLabRecords(moleculeId: string, limit = 150): Promise<LabRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `select pathogen_key, assay_chembl_id, assay_description, activity_type,
            activity_relation, activity_value, activity_units, label,
            document_chembl_id, document_year
       from bioactivity
      where molecule_id = ? and label is not null
      order by pathogen_key, case when document_year is null then 1 else 0 end,
               document_year desc, assay_chembl_id
      limit ?`,
    [moleculeId, limit],
  );
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  return rows.map((r) => ({
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    assayId: s(r.assay_chembl_id),
    assayDescription: s(r.assay_description),
    activityType: s(r.activity_type),
    relation: s(r.activity_relation),
    value: toNum(r.activity_value),
    units: s(r.activity_units),
    label: toNum(r.label) ?? 0,
    documentId: s(r.document_chembl_id),
    year: toNum(r.document_year),
  }));
}

/** The validated structure of one medicine, or null when it has none. */
export async function getStructureSmiles(moleculeId: string): Promise<string | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select canonical_smiles from molecules where molecule_id = ? and is_valid`,
    [moleculeId],
  );
  return row?.canonical_smiles == null ? null : String(row.canonical_smiles);
}

/**
 * Whether a stereoisomer of this medicine carried a label in an ACTIVE model's
 * training data, per pathogen.
 *
 * A medicine can be absent from every training set while its mirror image is
 * in one. Saying only "not in the training data" would then be true and
 * misleading, so the page says the more precise thing.
 */
export async function getStereoisomerInTraining(moleculeId: string): Promise<PathogenKey[]> {
  const skeleton = moleculeId.split("-")[0];
  if (!skeleton) return [];
  const rows = await query<Record<string, unknown>>(
    `select distinct dm.pathogen_key
       from dataset_members dm
      where dm.molecule_id like ? and dm.molecule_id <> ?
        and dm.dataset_version in (
          select distinct dataset_version from model_versions where status = 'ACTIVE')`,
    [`${skeleton}-%`, moleculeId],
  );
  return rows.map((r) => String(r.pathogen_key) as PathogenKey);
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

/** A user's text as a LIKE needle; wildcards they typed are taken literally out. */
function likeNeedle(text: string): string | null {
  const clean = text.trim().toLowerCase().replace(/[%_]/g, " ").replace(/\s+/g, " ");
  return clean.length >= 2 ? `%${clean}%` : null;
}

/**
 * The words a study's conditions must mention to count for this condition.
 *
 * For a modelled pathogen these are the gate's own patterns plus what was
 * typed, so the documented evidence and the model always describe the same
 * organism. Otherwise it is the typed text alone.
 */
export function conditionTerms(text: string, pathogenKey: PathogenKey | null): string[] {
  const typed = text.trim().toLowerCase().replace(/[%_]/g, " ").replace(/\s+/g, " ");
  const terms = new Set<string>();
  if (pathogenKey) {
    for (const t of pathogenConditionTerms(pathogenKey)) terms.add(t);
    // A short abbreviation ("tb") would match inside other words; the
    // pathogen's own terms already cover it as a whole word.
    if (typed.length >= 4 && ![...terms].some((t) => t.trim() === typed)) terms.add(typed);
  } else if (typed.length >= 2) {
    terms.add(typed);
  }
  return [...terms];
}

/**
 * A SQL predicate over `ct.conditions` for a set of terms.
 *
 * The registry stores conditions as one `;`-separated string. Separators are
 * turned into spaces and the whole is padded, so a term written with its own
 * surrounding spaces (" tb ") matches a whole word and nothing inside one.
 */
export function conditionMatch(terms: string[]): { sql: string; params: string[] } {
  if (terms.length === 0) return { sql: "1 = 0", params: [] };
  return {
    sql:
      "(" +
      terms
        .map(() => "(' ' || replace(lower(ct.conditions), ';', ' ') || ' ') like ?")
        .join(" or ") +
      ")",
    params: terms.map((t) => `%${t}%`),
  };
}

export interface DocumentedByStudies {
  moleculeId: string;
  name: string;
  studies: number;
}

/** Medicines with registered studies whose conditions mention these terms. */
export async function getMedicinesWithStudies(terms: string[]): Promise<DocumentedByStudies[]> {
  const match = conditionMatch(terms);
  const rows = await query<Record<string, unknown>>(
    `select d.molecule_id, d.generic_name, count(distinct ct.nct_id) as n
       from clinical_trials ct
       join ${ONE_PER_MEDICINE} one on one.molecule_id = ct.molecule_id
       join drugs d on d.drug_id = one.drug_id
      where ${match.sql}
      group by d.molecule_id, d.generic_name
      order by d.generic_name asc`,
    match.params,
  );
  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    name: String(r.generic_name),
    studies: toNum(r.n) ?? 0,
  }));
}

export interface DocumentedByLab {
  moleculeId: string;
  name: string;
  records: number;
  measuredActive: number;
}

/** Medicines with laboratory activity records against one pathogen. */
export async function getMedicinesWithLabRecords(
  pathogenKey: PathogenKey,
): Promise<DocumentedByLab[]> {
  const rows = await query<Record<string, unknown>>(
    `select d.molecule_id, d.generic_name, count(*) as n,
            sum(case when b.label = 1 then 1 else 0 end) as actives
       from bioactivity b
       join ${ONE_PER_MEDICINE} one on one.molecule_id = b.molecule_id
       join drugs d on d.drug_id = one.drug_id
      where b.pathogen_key = ? and b.label is not null
      group by d.molecule_id, d.generic_name
      order by d.generic_name asc`,
    [pathogenKey],
  );
  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    name: String(r.generic_name),
    records: toNum(r.n) ?? 0,
    measuredActive: toNum(r.actives) ?? 0,
  }));
}

/**
 * The set of medicines already documented for a condition, as a subquery over
 * `molecule_id` — used to keep them out of the computational candidates.
 */
export function documentedSet(
  terms: string[],
  pathogenKey: PathogenKey,
): { sql: string; params: (string | number)[] } {
  const match = conditionMatch(terms);
  return {
    sql:
      `select ct.molecule_id from clinical_trials ct where ct.molecule_id is not null and ${match.sql} ` +
      `union select b.molecule_id from bioactivity b where b.pathogen_key = ? and b.label is not null`,
    params: [...match.params, pathogenKey],
  };
}

export interface ConditionSuggestion {
  name: string;
  note: string;
  modelled: boolean;
}

const MODELLED_STARTERS: [string, PathogenKey][] = [
  ["MRSA infection", "mrsa"],
  ["E. coli infection", "ecoli"],
  ["K. pneumoniae infection", "kpneumoniae"],
  ["Tuberculosis", "mtb"],
];

/** The condition each pathogen card links to. */
export function conditionForPathogen(key: PathogenKey): string {
  return MODELLED_STARTERS.find(([, k]) => k === key)?.[0] ?? key;
}

/**
 * Conditions to offer as you type: the four with a model first, then what the
 * registry records.
 */
export async function getConditionSuggestions(
  term: string,
  limit = 8,
): Promise<ConditionSuggestion[]> {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];

  const out: ConditionSuggestion[] = MODELLED_STARTERS.filter(([name]) =>
    name.toLowerCase().includes(needle),
  ).map(([name]) => ({ name, note: "AI activity model available", modelled: true }));

  const rows = await query<Record<string, unknown>>(
    `select conditions, count(*) as n from clinical_trials
      where conditions is not null and lower(conditions) like ?
      group by conditions order by n desc limit ?`,
    [`%${needle.replace(/[%_]/g, " ")}%`, limit * 4],
  );

  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = toNum(r.n) ?? 0;
    for (const part of String(r.conditions).split(";")) {
      const name = part.trim();
      if (!name || !name.toLowerCase().includes(needle)) continue;
      counts.set(name, (counts.get(name) ?? 0) + n);
    }
  }

  for (const [name] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.length >= limit) break;
    if (out.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, note: "Registered studies", modelled: false });
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Registered studies                                                  */
/* ------------------------------------------------------------------ */

export interface Study {
  nctId: string;
  title: string | null;
  conditions: string | null;
  interventions: string | null;
  phase: string | null;
  status: string | null;
  startDate: string | null;
  url: string | null;
}

export interface StudyPage {
  rows: Study[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Registered studies, one row per registration.
 *
 * A study that names two medicines in this library is stored once per
 * medicine; grouping on the NCT id counts and lists it once.
 */
export async function getStudies(options: {
  terms?: string[];
  moleculeId?: string;
  page?: number;
  pageSize?: number;
}): Promise<StudyPage> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? 15;

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (options.moleculeId) {
    where.push("ct.molecule_id = ?");
    params.push(options.moleculeId);
  }
  if (options.terms && options.terms.length > 0) {
    const match = conditionMatch(options.terms);
    where.push(match.sql);
    params.push(...match.params);
  }
  const clause = where.length ? `where ${where.join(" and ")}` : "";

  const count = await queryOne<Record<string, unknown>>(
    `select count(distinct ct.nct_id) as n from clinical_trials ct ${clause}`,
    params,
  );
  const rows = await query<Record<string, unknown>>(
    `select ct.nct_id,
            max(ct.brief_title)     as title,
            max(ct.conditions)      as conditions,
            max(ct.interventions)   as interventions,
            max(ct.phase)           as phase,
            max(ct.overall_status)  as status,
            max(ct.start_date)      as start_date,
            max(ct.url)             as url
       from clinical_trials ct ${clause}
      group by ct.nct_id
      order by case when max(ct.start_date) is null then 1 else 0 end,
               max(ct.start_date) desc, ct.nct_id asc
      limit ? offset ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    total: toNum(count?.n) ?? 0,
    page,
    pageSize,
    rows: rows.map((r) => ({
      nctId: String(r.nct_id),
      title: s(r.title),
      conditions: s(r.conditions),
      interventions: s(r.interventions),
      phase: s(r.phase),
      status: s(r.status),
      startDate: s(r.start_date),
      url: s(r.url),
    })),
  };
}

/** Distinct registered studies naming one medicine, whatever the condition. */
export async function countStudiesForMedicine(moleculeId: string): Promise<number> {
  const row = await queryOne<Record<string, unknown>>(
    `select count(distinct nct_id) as n from clinical_trials where molecule_id = ?`,
    [moleculeId],
  );
  return toNum(row?.n) ?? 0;
}

/** The conditions this medicine's registered studies name, for its filter. */
export async function getStudyConditionsForMedicine(
  moleculeId: string,
  limit = 60,
): Promise<{ name: string; studies: number }[]> {
  const rows = await query<Record<string, unknown>>(
    `select nct_id, max(conditions) as conditions from clinical_trials
      where molecule_id = ? and conditions is not null
      group by nct_id`,
    [moleculeId],
  );
  const counts = new Map<string, { name: string; studies: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const part of String(r.conditions).split(";")) {
      const name = part.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name, studies: 0 };
      entry.studies += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.studies - a.studies || a.name.localeCompare(b.name))
    .slice(0, limit);
}
