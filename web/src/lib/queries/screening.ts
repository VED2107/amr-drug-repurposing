import "server-only";

/**
 * Queries behind Drug Screening and the Candidate Explorer.
 *
 * Sorting, filtering and pagination are presentation concerns and are done in
 * SQL for speed. None of them change what a value means: a filtered-out row is
 * absent from the view, never recorded as a negative result.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import type { PathogenKey } from "@/lib/types";
import { PATHOGEN_KEYS } from "@/lib/types";

export interface ScreeningFilters {
  search?: string;
  pathogen?: PathogenKey;
  minProbability?: number;
  maxProbability?: number;
  hasDocking?: boolean;
  hasTrials?: boolean;
  hasMeasurements?: boolean;
  /** Exclude molecules the model was trained on, to see unseen chemistry only. */
  excludeTrainingData?: boolean;
  sort?: "probability" | "name";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface ScreeningRow {
  moleculeId: string;
  genericName: string;
  brandName: string | null;
  chemblId: string | null;
  pathogenKey: PathogenKey | null;
  probability: number | null;
  modelVersion: string | null;
  inTrainingData: boolean | null;
  trainingSplit: string | null;
  bestDockingScore: number | null;
  dockingTargetKey: string | null;
  trialCount: number;
  /** Null when this medicine has never been queried at the registry. */
  clinicalChecked: boolean;
  measuredRecords: number;
}

export interface ScreeningPage {
  rows: ScreeningRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Base projection shared by the table and the matrix.
 *
 * One approved product is chosen per molecule (`min(drug_id)`) so that a
 * structure appears once rather than once per brand. The brands themselves
 * remain reachable from Drug Details.
 */
const BASE_SELECT = `
  select
    d.molecule_id                                          as molecule_id,
    d.generic_name                                         as generic_name,
    d.brand_name                                           as brand_name,
    d.chembl_id                                            as chembl_id,
    p.pathogen_key                                         as pathogen_key,
    p.probability                                          as probability,
    p.model_version                                        as model_version,
    case when p.dataset_version is null then null
         when dm.molecule_id is not null then 1 else 0 end as in_training_data,
    dm.split                                               as training_split,
    dk.best_score                                          as best_docking_score,
    dk.target_key                                          as docking_target_key,
    coalesce(ct.n, 0)                                      as trial_count,
    case when cq.molecule_id is null then 0 else 1 end     as clinical_checked,
    coalesce(ba.n, 0)                                      as measured_records
  from (
    select molecule_id, min(drug_id) as drug_id
      from drugs where molecule_id is not null
     group by molecule_id
  ) one
  join drugs d on d.drug_id = one.drug_id
  left join predictions p
    on p.molecule_id = d.molecule_id
   and p.pathogen_key = ?
   and p.model_version = (
        select m.model_version from model_versions m
         where m.pathogen_key = ? and m.status = 'ACTIVE'
         order by m.training_date desc limit 1)
  left join dataset_members dm
    on dm.dataset_version = p.dataset_version
   and dm.molecule_id     = p.molecule_id
   and dm.pathogen_key    = p.pathogen_key
  left join (
    select molecule_id, pathogen_key, target_key, min(score_kcal_mol) as best_score
      from docking_results where status = 'ok' and score_kcal_mol is not null
     group by molecule_id, pathogen_key, target_key
  ) dk on dk.molecule_id = d.molecule_id and dk.pathogen_key = ?
  left join (
    select molecule_id, count(*) as n from clinical_trials group by molecule_id
  ) ct on ct.molecule_id = d.molecule_id
  left join clinical_queries cq on cq.molecule_id = d.molecule_id
  left join (
    select molecule_id, pathogen_key, count(*) as n
      from bioactivity where label is not null group by molecule_id, pathogen_key
  ) ba on ba.molecule_id = d.molecule_id and ba.pathogen_key = ?
`;

function buildWhere(f: ScreeningFilters): { clause: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];

  if (f.search && f.search.trim()) {
    const needle = `%${f.search.trim().toLowerCase()}%`;
    parts.push(
      "(lower(d.generic_name) like ? or lower(coalesce(d.brand_name,'')) like ? " +
        "or lower(coalesce(d.chembl_id,'')) like ? or lower(d.molecule_id) like ?)",
    );
    params.push(needle, needle, needle, needle);
  }
  if (typeof f.minProbability === "number") {
    parts.push("p.probability >= ?");
    params.push(f.minProbability);
  }
  if (typeof f.maxProbability === "number") {
    parts.push("p.probability <= ?");
    params.push(f.maxProbability);
  }
  if (f.hasDocking) parts.push("dk.best_score is not null");
  if (f.hasTrials) parts.push("coalesce(ct.n, 0) > 0");
  if (f.hasMeasurements) parts.push("coalesce(ba.n, 0) > 0");
  if (f.excludeTrainingData) parts.push("dm.molecule_id is null");

  return {
    clause: parts.length ? `where ${parts.join(" and ")}` : "",
    params,
  };
}

export async function getScreeningPage(filters: ScreeningFilters): Promise<ScreeningPage> {
  const pathogen = filters.pathogen ?? "mrsa";
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 25));
  const { clause, params } = buildWhere(filters);

  // The pathogen key is bound four times by BASE_SELECT before any filter.
  const base = [pathogen, pathogen, pathogen, pathogen];

  const orderColumn =
    filters.sort === "name"
      ? "d.generic_name"
      : // Rows without a prediction sort last regardless of direction: a missing
        // value is not a low value.
        "case when p.probability is null then 1 else 0 end, p.probability";
  const direction = filters.direction === "asc" ? "asc" : "desc";

  const countRow = await queryOne<Record<string, unknown>>(
    `select count(*) as n from (${BASE_SELECT} ${clause}) t`,
    [...base, ...params],
  );

  const rows = await query<Record<string, unknown>>(
    `${BASE_SELECT} ${clause}
     order by ${orderColumn} ${direction}, d.generic_name asc
     limit ? offset ?`,
    [...base, ...params, pageSize, (page - 1) * pageSize],
  );

  return {
    total: toNum(countRow?.n) ?? 0,
    page,
    pageSize,
    rows: rows.map((r) => ({
      moleculeId: String(r.molecule_id),
      genericName: String(r.generic_name),
      brandName: r.brand_name == null ? null : String(r.brand_name),
      chemblId: r.chembl_id == null ? null : String(r.chembl_id),
      pathogenKey: r.pathogen_key == null ? null : (String(r.pathogen_key) as PathogenKey),
      probability: toNum(r.probability),
      modelVersion: r.model_version == null ? null : String(r.model_version),
      inTrainingData: r.in_training_data == null ? null : Number(r.in_training_data) === 1,
      trainingSplit: r.training_split == null ? null : String(r.training_split),
      bestDockingScore: toNum(r.best_docking_score),
      dockingTargetKey: r.docking_target_key == null ? null : String(r.docking_target_key),
      trialCount: toNum(r.trial_count) ?? 0,
      clinicalChecked: Number(r.clinical_checked) === 1,
      measuredRecords: toNum(r.measured_records) ?? 0,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Candidate matrix                                                    */
/* ------------------------------------------------------------------ */

export interface MatrixCell {
  pathogenKey: PathogenKey;
  probability: number | null;
  modelVersion: string | null;
  inTrainingData: boolean | null;
  bestDockingScore: number | null;
}

export interface MatrixRow {
  moleculeId: string;
  genericName: string;
  brandName: string | null;
  trialCount: number;
  clinicalChecked: boolean;
  cells: MatrixCell[];
}

/**
 * One medicine × four bacteria.
 *
 * Ordered by the highest probability the medicine reaches across the four
 * models. That is a display ordering, not a ranking of merit: the page states
 * so, and the cells carry their own labels.
 */
export async function getCandidateMatrix(options: {
  search?: string;
  limit?: number;
  minProbability?: number;
  /**
   * Which model's output orders the rows, or `null` for alphabetical.
   *
   * The default is alphabetical on purpose. Ordering by the highest value a
   * medicine reaches in any column would be a ranking across four different
   * models — it would put a medicine "first" on the strength of whichever
   * pathogen happened to score it highest, which is not a statement any of
   * those models makes. Sorting by one named column is a different act: it
   * orders by one model's output and says so.
   */
  sortPathogen?: PathogenKey | null;
}): Promise<MatrixRow[]> {
  const limit = Math.min(200, Math.max(5, options.limit ?? 40));
  const params: (string | number)[] = [];

  let searchClause = "";
  if (options.search && options.search.trim()) {
    const needle = `%${options.search.trim().toLowerCase()}%`;
    searchClause =
      "and (lower(d.generic_name) like ? or lower(coalesce(d.brand_name,'')) like ?)";
    params.push(needle, needle);
  }

  // The alias inside the subquery is `p2`; `p` belongs to the outer query and
  // is not in scope here.
  const minClause =
    typeof options.minProbability === "number" ? "having max(p2.probability) >= ?" : "";
  if (typeof options.minProbability === "number") params.push(options.minProbability);

  /*
    The selection of *which* medicines appear still uses the highest value a
    medicine reaches, because a filter has to select somehow and "has at least
    one prediction at or above X" is a statement about coverage. The order they
    are then shown in is a separate decision, made below.
  */
  const sortKey = options.sortPathogen ?? null;

  /*
    Placeholders are positional, so the pieces that carry one are assembled
    together with the values that fill them. `sortValueSelect` and the two
    order clauses each contribute either one `?` or none.

    A missing prediction sorts last rather than sorting as zero — written the
    portable way (`case when … is null`) because `nulls last` is not accepted by
    both engines this query has to run on.
  */
  const sortValueSelect = sortKey
    ? ", max(case when p2.pathogen_key = ? then p2.probability end) as sort_value"
    : "";
  const innerOrder = sortKey
    ? "order by max(case when p2.pathogen_key = ? then p2.probability end) desc"
    : "order by min(d.generic_name) asc";
  const outerOrder = sortKey
    ? "order by case when top_meds.sort_value is null then 1 else 0 end, " +
      "top_meds.sort_value desc, d.generic_name asc"
    : "order by d.generic_name asc";

  const rows = await query<Record<string, unknown>>(
    `select
        d.molecule_id                                       as molecule_id,
        d.generic_name                                      as generic_name,
        d.brand_name                                        as brand_name,
        p.pathogen_key                                      as pathogen_key,
        p.probability                                       as probability,
        p.model_version                                     as model_version,
        case when p.dataset_version is null then null
             when dm.molecule_id is not null then 1 else 0 end as in_training_data,
        dk.best_score                                       as best_docking_score,
        coalesce(ct.n, 0)                                   as trial_count,
        case when cq.molecule_id is null then 0 else 1 end  as clinical_checked
      from (
        select one.molecule_id, max(p2.probability) as top${sortValueSelect}
          from (select molecule_id, min(drug_id) as drug_id
                  from drugs where molecule_id is not null group by molecule_id) one
          join drugs d on d.drug_id = one.drug_id
          join predictions p2 on p2.molecule_id = one.molecule_id
          join model_versions m2
            on m2.model_version = p2.model_version and m2.status = 'ACTIVE'
         where 1 = 1 ${searchClause}
         group by one.molecule_id
         ${minClause}
         ${innerOrder}
         limit ?
      ) top_meds
      join (select molecule_id, min(drug_id) as drug_id
              from drugs where molecule_id is not null group by molecule_id) one
        on one.molecule_id = top_meds.molecule_id
      join drugs d on d.drug_id = one.drug_id
      left join predictions p
        on p.molecule_id = d.molecule_id
       and p.model_version in (select model_version from model_versions where status = 'ACTIVE')
      left join dataset_members dm
        on dm.dataset_version = p.dataset_version
       and dm.molecule_id     = p.molecule_id
       and dm.pathogen_key    = p.pathogen_key
      left join (
        select molecule_id, pathogen_key, min(score_kcal_mol) as best_score
          from docking_results where status = 'ok' and score_kcal_mol is not null
         group by molecule_id, pathogen_key
      ) dk on dk.molecule_id = d.molecule_id and dk.pathogen_key = p.pathogen_key
      left join (select molecule_id, count(*) as n from clinical_trials group by molecule_id) ct
        on ct.molecule_id = d.molecule_id
      left join clinical_queries cq on cq.molecule_id = d.molecule_id
      ${outerOrder}`,
    // Placeholder order: sortValueSelect, search/min filters, innerOrder, limit.
    sortKey ? [sortKey, ...params, sortKey, limit] : [...params, limit],
  );

  const byMolecule = new Map<string, MatrixRow>();
  for (const r of rows) {
    const id = String(r.molecule_id);
    let row = byMolecule.get(id);
    if (!row) {
      row = {
        moleculeId: id,
        genericName: String(r.generic_name),
        brandName: r.brand_name == null ? null : String(r.brand_name),
        trialCount: toNum(r.trial_count) ?? 0,
        clinicalChecked: Number(r.clinical_checked) === 1,
        cells: [],
      };
      byMolecule.set(id, row);
    }
    if (r.pathogen_key != null) {
      row.cells.push({
        pathogenKey: String(r.pathogen_key) as PathogenKey,
        probability: toNum(r.probability),
        modelVersion: r.model_version == null ? null : String(r.model_version),
        inTrainingData: r.in_training_data == null ? null : Number(r.in_training_data) === 1,
        bestDockingScore: toNum(r.best_docking_score),
      });
    }
  }

  // Every row carries all four columns. A pathogen with no prediction for this
  // medicine gets an explicit empty cell rather than being silently dropped.
  return [...byMolecule.values()].map((row) => ({
    ...row,
    cells: PATHOGEN_KEYS.map(
      (key) =>
        row.cells.find((c) => c.pathogenKey === key) ?? {
          pathogenKey: key,
          probability: null,
          modelVersion: null,
          inTrainingData: null,
          bestDockingScore: null,
        },
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  moleculeId: string;
  name: string;
  note: string;
}

export async function searchMedicines(term: string, limit = 8): Promise<SearchHit[]> {
  if (!term.trim()) return [];
  const needle = `%${term.trim().toLowerCase()}%`;
  const rows = await query<Record<string, unknown>>(
    `select one.molecule_id, d.generic_name, d.brand_name, d.approval_source
       from (select molecule_id, min(drug_id) as drug_id
               from drugs where molecule_id is not null group by molecule_id) one
       join drugs d on d.drug_id = one.drug_id
      where lower(d.generic_name) like ? or lower(coalesce(d.brand_name,'')) like ?
      order by length(d.generic_name) asc
      limit ?`,
    [needle, needle, limit],
  );
  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    name: String(r.generic_name),
    note: r.brand_name ? `${String(r.brand_name)} · ${String(r.approval_source)}` : String(r.approval_source),
  }));
}
