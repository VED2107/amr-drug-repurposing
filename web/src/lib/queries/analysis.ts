import "server-only";

/**
 * Aggregates for the evidence surfaces: molecular, docking and clinical.
 *
 * Everything here is a `count` or a `min`/`max` over rows that exist. There is
 * no interpolation, no smoothing and no estimated distribution: a histogram
 * bucket is the number of molecules whose stored descriptor falls in that
 * range, and a bucket with no molecules is shown as empty rather than dropped,
 * because a gap in a distribution is a fact about the library.
 *
 * Bucketing is written with `case when` rather than `width_bucket` or
 * `percentile_cont` so the same statement runs on SQLite and Postgres.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import type { PathogenKey } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Molecular                                                           */
/* ------------------------------------------------------------------ */

export interface MolecularOverview {
  molecules: number;
  valid: number;
  invalid: number;
  withDescriptors: number;
  distinctScaffolds: number;
  lipinskiPass: number;
  lipinskiOne: number;
  lipinskiMultiple: number;
  featureVersions: string[];
}

export async function getMolecularOverview(): Promise<MolecularOverview> {
  const row = await queryOne<Record<string, unknown>>(`
    select
      (select count(*) from molecules)                                as molecules,
      (select count(*) from molecules where is_valid)                 as valid,
      (select count(*) from molecules where not is_valid)             as invalid,
      (select count(*) from molecules where mw is not null)           as with_descriptors,
      (select count(distinct murcko_scaffold) from molecules
        where murcko_scaffold is not null and murcko_scaffold <> '')  as distinct_scaffolds,
      (select count(*) from molecules where lipinski_violations = 0)  as lipinski_pass,
      (select count(*) from molecules where lipinski_violations = 1)  as lipinski_one,
      (select count(*) from molecules where lipinski_violations > 1)  as lipinski_multiple
  `);

  const versions = await query<Record<string, unknown>>(
    `select distinct feature_version from molecules
      where feature_version is not null order by feature_version`,
  );

  return {
    molecules: toNum(row?.molecules) ?? 0,
    valid: toNum(row?.valid) ?? 0,
    invalid: toNum(row?.invalid) ?? 0,
    withDescriptors: toNum(row?.with_descriptors) ?? 0,
    distinctScaffolds: toNum(row?.distinct_scaffolds) ?? 0,
    lipinskiPass: toNum(row?.lipinski_pass) ?? 0,
    lipinskiOne: toNum(row?.lipinski_one) ?? 0,
    lipinskiMultiple: toNum(row?.lipinski_multiple) ?? 0,
    featureVersions: versions.map((r) => String(r.feature_version)),
  };
}

export interface HistogramBucket {
  label: string;
  count: number;
}

/**
 * A descriptor distribution over fixed, stated edges.
 *
 * The edges are passed in and rendered next to the chart rather than chosen by
 * the data, so two runs of the pipeline produce comparable pictures.
 */
export async function getDescriptorHistogram(
  column: "mw" | "logp" | "tpsa" | "qed",
  edges: number[],
): Promise<HistogramBucket[]> {
  const cases: string[] = [];
  const labels: string[] = [];

  cases.push(`sum(case when ${column} < ${edges[0]} then 1 else 0 end) as b0`);
  labels.push(`< ${edges[0]}`);

  for (let i = 0; i < edges.length - 1; i++) {
    cases.push(
      `sum(case when ${column} >= ${edges[i]} and ${column} < ${edges[i + 1]} then 1 else 0 end) as b${i + 1}`,
    );
    labels.push(`${edges[i]}–${edges[i + 1]}`);
  }

  cases.push(
    `sum(case when ${column} >= ${edges[edges.length - 1]} then 1 else 0 end) as b${edges.length}`,
  );
  labels.push(`≥ ${edges[edges.length - 1]}`);

  const row = await queryOne<Record<string, unknown>>(
    `select ${cases.join(", ")} from molecules where ${column} is not null`,
  );

  return labels.map((label, i) => ({ label, count: toNum(row?.[`b${i}`]) ?? 0 }));
}

export interface ScaffoldRow {
  scaffold: string;
  molecules: number;
}

export async function getTopScaffolds(limit = 12): Promise<ScaffoldRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select murcko_scaffold, count(*) as n from molecules
      where murcko_scaffold is not null and murcko_scaffold <> ''
      group by murcko_scaffold order by n desc, murcko_scaffold asc limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    scaffold: String(r.murcko_scaffold),
    molecules: toNum(r.n) ?? 0,
  }));
}

export interface ValidationFailure {
  moleculeId: string;
  prefName: string | null;
  error: string | null;
}

/** Structures the chemistry stage rejected, with the reason it gave. */
export async function getValidationFailures(limit = 20): Promise<ValidationFailure[]> {
  const rows = await query<Record<string, unknown>>(
    `select molecule_id, pref_name, validation_error from molecules
      where not is_valid order by molecule_id limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    prefName: r.pref_name == null ? null : String(r.pref_name),
    error: r.validation_error == null ? null : String(r.validation_error),
  }));
}

/* ------------------------------------------------------------------ */
/* Docking                                                             */
/* ------------------------------------------------------------------ */

export interface DockingCoverage {
  targets: number;
  runs: number;
  poses: number;
  ligandTargetPairs: number;
  dockedMolecules: number;
  failedPoses: number;
  bestScore: number | null;
  worstScore: number | null;
  atOrBelowTarget: number;
}

export async function getDockingCoverage(
  screeningTarget: number,
): Promise<DockingCoverage> {
  const row = await queryOne<Record<string, unknown>>(
    `select
       (select count(*) from targets)                                   as targets,
       (select count(*) from docking_runs)                              as runs,
       (select count(*) from docking_results where status = 'ok')       as poses,
       (select count(*) from (
          select molecule_id, target_key from docking_results
           where status = 'ok' group by molecule_id, target_key) t)     as pairs,
       (select count(distinct molecule_id) from docking_results
         where status = 'ok')                                           as docked_molecules,
       (select count(*) from docking_results where status <> 'ok')      as failed,
       (select min(score_kcal_mol) from docking_results where status = 'ok') as best,
       (select max(score_kcal_mol) from docking_results where status = 'ok') as worst,
       (select count(*) from (
          select molecule_id, target_key, min(score_kcal_mol) as s
            from docking_results where status = 'ok' and score_kcal_mol is not null
           group by molecule_id, target_key) b
         where b.s <= ?)                                                as at_or_below`,
    [screeningTarget],
  );

  return {
    targets: toNum(row?.targets) ?? 0,
    runs: toNum(row?.runs) ?? 0,
    poses: toNum(row?.poses) ?? 0,
    ligandTargetPairs: toNum(row?.pairs) ?? 0,
    dockedMolecules: toNum(row?.docked_molecules) ?? 0,
    failedPoses: toNum(row?.failed) ?? 0,
    bestScore: toNum(row?.best),
    worstScore: toNum(row?.worst),
    atOrBelowTarget: toNum(row?.at_or_below) ?? 0,
  };
}

export interface BestPoseRow {
  moleculeId: string;
  genericName: string | null;
  targetKey: string;
  pathogenKey: PathogenKey;
  score: number;
  runId: string;
}

/** The best-scoring pose per molecule and target. An ordering, not a ranking. */
export async function getBestPoses(options: {
  targetKey?: string;
  limit?: number;
}): Promise<BestPoseRow[]> {
  const limit = Math.min(200, Math.max(5, options.limit ?? 25));
  const params: (string | number)[] = [];
  let clause = "";
  if (options.targetKey) {
    clause = "and dr.target_key = ?";
    params.push(options.targetKey);
  }

  const rows = await query<Record<string, unknown>>(
    `select b.molecule_id, b.target_key, b.pathogen_key, b.s as score, b.run_id,
            d.generic_name
       from (
         select dr.molecule_id, dr.target_key, dr.pathogen_key,
                min(dr.score_kcal_mol) as s, min(dr.run_id) as run_id
           from docking_results dr
          where dr.status = 'ok' and dr.score_kcal_mol is not null ${clause}
          group by dr.molecule_id, dr.target_key, dr.pathogen_key
       ) b
       left join (
         select molecule_id, min(drug_id) as drug_id from drugs
          where molecule_id is not null group by molecule_id
       ) one on one.molecule_id = b.molecule_id
       left join drugs d on d.drug_id = one.drug_id
      order by b.s asc
      limit ?`,
    [...params, limit],
  );

  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    genericName: r.generic_name == null ? null : String(r.generic_name),
    targetKey: String(r.target_key),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    score: toNum(r.score) as number,
    runId: String(r.run_id),
  }));
}

/* ------------------------------------------------------------------ */
/* Clinical                                                            */
/* ------------------------------------------------------------------ */

export interface ClinicalOverview {
  medicinesQueried: number;
  medicinesTotal: number;
  queriesFailed: number;
  medicinesWithNoResults: number;
  medicinesWithStudies: number;
  trialLinks: number;
  distinctStudies: number;
  amrRelatedLinks: number;
  lastRetrieved: string | null;
}

export async function getClinicalOverview(): Promise<ClinicalOverview> {
  const row = await queryOne<Record<string, unknown>>(`
    select
      (select count(*) from clinical_queries)                            as queried,
      (select count(distinct molecule_id) from drugs
        where molecule_id is not null)                                   as total,
      (select count(*) from clinical_queries where status <> 'ok')       as failed,
      (select count(*) from clinical_queries where n_results = 0)        as no_results,
      (select count(*) from clinical_queries where n_results > 0)        as with_studies,
      (select count(*) from clinical_trials)                             as links,
      (select count(distinct nct_id) from clinical_trials)               as studies,
      (select count(*) from clinical_trials where amr_related)           as amr_links,
      (select max(retrieved_at) from clinical_queries)                   as last_retrieved
  `);

  return {
    medicinesQueried: toNum(row?.queried) ?? 0,
    medicinesTotal: toNum(row?.total) ?? 0,
    queriesFailed: toNum(row?.failed) ?? 0,
    medicinesWithNoResults: toNum(row?.no_results) ?? 0,
    medicinesWithStudies: toNum(row?.with_studies) ?? 0,
    trialLinks: toNum(row?.links) ?? 0,
    distinctStudies: toNum(row?.studies) ?? 0,
    amrRelatedLinks: toNum(row?.amr_links) ?? 0,
    lastRetrieved: row?.last_retrieved == null ? null : String(row.last_retrieved).slice(0, 10),
  };
}

export interface LabelledCount {
  label: string;
  count: number;
}

export async function getTrialBreakdown(
  column: "phase" | "overall_status" | "study_type",
  limit = 12,
): Promise<LabelledCount[]> {
  const rows = await query<Record<string, unknown>>(
    `select coalesce(${column}, '') as label, count(*) as n
       from clinical_trials group by coalesce(${column}, '')
      order by n desc limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    // An empty string in the registry is "not recorded", which is a different
    // statement from a phase of zero, so it is labelled rather than blanked.
    label: String(r.label) === "" ? "not recorded" : String(r.label),
    count: toNum(r.n) ?? 0,
  }));
}

export async function getTopTrialConditions(limit = 15): Promise<LabelledCount[]> {
  const rows = await query<Record<string, unknown>>(
    `select conditions, count(*) as n from clinical_trials
      where conditions is not null and conditions <> ''
      group by conditions order by n desc limit ?`,
    [limit * 4],
  );

  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = toNum(r.n) ?? 0;
    for (const part of String(r.conditions).split(";")) {
      const name = part.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + n);
    }
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

export interface ConditionSuggestion {
  name: string;
  note: string;
  modelled: boolean;
}

/**
 * Conditions to offer as you type.
 *
 * The four modelled bacteria are offered first when they match, because they
 * are the only conditions that can produce a probability, and the flag travels
 * with the suggestion so the interface can say so before the reader commits to
 * a pairing. Everything else comes from conditions the registry records.
 */
export async function getConditionSuggestions(
  term: string,
  limit = 8,
): Promise<ConditionSuggestion[]> {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const modelledStarters = [
    "MRSA",
    "Methicillin-resistant Staphylococcus aureus",
    "Escherichia coli infection",
    "Klebsiella pneumoniae infection",
    "Tuberculosis",
  ];

  const out: ConditionSuggestion[] = modelledStarters
    .filter((name) => name.toLowerCase().includes(needle))
    .map((name) => ({ name, note: "a model exists", modelled: true }));

  const rows = await query<Record<string, unknown>>(
    `select conditions, count(*) as n from clinical_trials
      where conditions is not null and lower(conditions) like ?
      group by conditions order by n desc limit ?`,
    [`%${needle}%`, limit * 4],
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

  for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.length >= limit) break;
    if (out.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      name,
      note: `${n.toLocaleString("en-GB")} registered ${n === 1 ? "study" : "studies"}`,
      modelled: false,
    });
  }

  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Model benchmarks                                                    */
/* ------------------------------------------------------------------ */

export interface BenchmarkRow {
  benchmarkRunId: string;
  pathogenKey: PathogenKey;
  modelType: string;
  modelVersion: string | null;
  datasetVersion: string | null;
  isBaseline: boolean;
  selected: boolean;
  metrics: Record<string, number> | null;
  createdAt: string;
}

/**
 * Every candidate a benchmark run evaluated, selected or not.
 *
 * The models that were not promoted are the context for the one that was, so
 * they are shown rather than filtered out: a registry that only ever displays
 * its winners reads as though nothing was ever in contention.
 */
export async function getBenchmarks(limit = 60): Promise<BenchmarkRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select benchmark_run_id, pathogen_key, model_type, model_version, dataset_version,
            is_baseline, selected, metrics_json, created_at
       from model_benchmarks
      order by created_at desc, pathogen_key, model_type
      limit ?`,
    [limit],
  );

  return rows.map((r) => ({
    benchmarkRunId: String(r.benchmark_run_id),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    modelType: String(r.model_type),
    modelVersion: r.model_version == null ? null : String(r.model_version),
    datasetVersion: r.dataset_version == null ? null : String(r.dataset_version),
    isBaseline: Boolean(r.is_baseline),
    selected: Boolean(r.selected),
    metrics: parseMetrics(r.metrics_json),
    createdAt: String(r.created_at),
  }));
}

function parseMetrics(value: unknown): Record<string, number> | null {
  if (value == null) return null;
  if (typeof value === "object") return value as Record<string, number>;
  try {
    return JSON.parse(String(value)) as Record<string, number>;
  } catch {
    // A metrics blob that will not parse is reported as absent rather than as
    // zeroes: an unreadable record is not a record of poor performance.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export interface StageSummary {
  stage: string;
  runs: number;
  lastRun: string | null;
  lastStatus: string | null;
  recordsProcessed: number;
  errors: number;
}

export async function getStageSummaries(): Promise<StageSummary[]> {
  const rows = await query<Record<string, unknown>>(
    `select stage,
            count(*)                        as runs,
            max(started_at)                 as last_run,
            sum(records_processed)          as processed,
            sum(error_count)                as errors
       from pipeline_runs group by stage order by max(started_at) desc`,
  );

  const statuses = await query<Record<string, unknown>>(
    `select stage, status, started_at from pipeline_runs order by started_at desc`,
  );

  return rows.map((r) => {
    const stage = String(r.stage);
    const latest = statuses.find((s) => String(s.stage) === stage);
    return {
      stage,
      runs: toNum(r.runs) ?? 0,
      lastRun: r.last_run == null ? null : String(r.last_run),
      lastStatus: latest?.status == null ? null : String(latest.status),
      recordsProcessed: toNum(r.processed) ?? 0,
      errors: toNum(r.errors) ?? 0,
    };
  });
}

export interface PipelineErrorRow {
  runId: string;
  stage: string;
  subject: string | null;
  errorType: string | null;
  message: string | null;
  createdAt: string;
}

export async function getPipelineErrors(limit = 25): Promise<PipelineErrorRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select run_id, stage, subject, error_type, message, created_at
       from pipeline_errors order by created_at desc limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    runId: String(r.run_id),
    stage: String(r.stage),
    subject: r.subject == null ? null : String(r.subject),
    errorType: r.error_type == null ? null : String(r.error_type),
    message: r.message == null ? null : String(r.message),
    createdAt: String(r.created_at),
  }));
}

export interface SourceRow {
  name: string;
  url: string | null;
  sourceVersion: string | null;
  retrievedAt: string;
  recordCount: number | null;
  notes: string | null;
}

export async function getDataSources(): Promise<SourceRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select name, url, source_version, retrieved_at, record_count, notes
       from data_sources order by retrieved_at desc`,
  );
  return rows.map((r) => ({
    name: String(r.name),
    url: r.url == null ? null : String(r.url),
    sourceVersion: r.source_version == null ? null : String(r.source_version),
    retrievedAt: String(r.retrieved_at),
    recordCount: toNum(r.record_count),
    notes: r.notes == null ? null : String(r.notes),
  }));
}
