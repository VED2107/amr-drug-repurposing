import "server-only";

/**
 * Queries behind the medicine directory and Drug Details.
 *
 * The scaffold-neighbour query at the bottom of this file exists because of a
 * real case in this database: Levoketoconazole is not itself a member of any
 * training set, but racemic Ketoconazole is, and the two share an identical
 * Murcko scaffold and InChIKey connectivity skeleton. Reporting only "this
 * molecule was not in the training data" would be true and misleading at the
 * same time, so the interface is given the means to say the more precise thing.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import type { PathogenKey } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Directory                                                           */
/* ------------------------------------------------------------------ */

export interface DirectoryRow {
  moleculeId: string;
  genericName: string;
  brandName: string | null;
  brandCount: number;
  chemblId: string | null;
  approvalSource: string;
  predictionCount: number;
  dockedPoses: number;
  trialCount: number;
  clinicalChecked: boolean;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

const DIRECTORY_FROM = `
  from (
    select molecule_id, min(drug_id) as drug_id, count(*) as brand_count
      from drugs where molecule_id is not null
     group by molecule_id
  ) one
  join drugs d on d.drug_id = one.drug_id
  left join (
    select p.molecule_id, count(*) as n
      from predictions p
      join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
     group by p.molecule_id
  ) pr on pr.molecule_id = d.molecule_id
  left join (
    select molecule_id, count(*) as n from docking_results where status = 'ok'
     group by molecule_id
  ) dk on dk.molecule_id = d.molecule_id
  left join (
    select molecule_id, count(*) as n from clinical_trials group by molecule_id
  ) ct on ct.molecule_id = d.molecule_id
  left join clinical_queries cq on cq.molecule_id = d.molecule_id
`;

export async function getMedicineDirectory(options: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<DirectoryPage> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, options.pageSize ?? 50));

  const params: (string | number)[] = [];
  let where = "";
  if (options.search && options.search.trim()) {
    const needle = `%${options.search.trim().toLowerCase()}%`;
    where =
      "where lower(d.generic_name) like ? or lower(coalesce(d.brand_name,'')) like ? " +
      "or lower(coalesce(d.chembl_id,'')) like ? or lower(d.molecule_id) like ?";
    params.push(needle, needle, needle, needle);
  }

  const countRow = await queryOne<Record<string, unknown>>(
    `select count(*) as n ${DIRECTORY_FROM} ${where}`,
    params,
  );

  const rows = await query<Record<string, unknown>>(
    `select d.molecule_id, d.generic_name, d.brand_name, d.chembl_id, d.approval_source,
            one.brand_count                as brand_count,
            coalesce(pr.n, 0)              as prediction_count,
            coalesce(dk.n, 0)              as docked_poses,
            coalesce(ct.n, 0)              as trial_count,
            case when cq.molecule_id is null then 0 else 1 end as clinical_checked
       ${DIRECTORY_FROM} ${where}
      order by d.generic_name asc
      limit ? offset ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  return {
    total: toNum(countRow?.n) ?? 0,
    page,
    pageSize,
    rows: rows.map((r) => ({
      moleculeId: String(r.molecule_id),
      genericName: String(r.generic_name),
      brandName: r.brand_name == null ? null : String(r.brand_name),
      brandCount: toNum(r.brand_count) ?? 1,
      chemblId: r.chembl_id == null ? null : String(r.chembl_id),
      approvalSource: String(r.approval_source),
      predictionCount: toNum(r.prediction_count) ?? 0,
      dockedPoses: toNum(r.docked_poses) ?? 0,
      trialCount: toNum(r.trial_count) ?? 0,
      clinicalChecked: Number(r.clinical_checked) === 1,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Per-medicine detail                                                 */
/* ------------------------------------------------------------------ */

/** Labelled bioactivity records for this molecule, per pathogen. */
export async function getMeasuredCountsByPathogen(
  moleculeId: string,
): Promise<Record<string, { records: number; actives: number }>> {
  const rows = await query<Record<string, unknown>>(
    `select pathogen_key, count(*) as n,
            sum(case when label = 1 then 1 else 0 end) as actives
       from bioactivity
      where molecule_id = ? and label is not null
      group by pathogen_key`,
    [moleculeId],
  );
  const out: Record<string, { records: number; actives: number }> = {};
  for (const r of rows) {
    out[String(r.pathogen_key)] = {
      records: toNum(r.n) ?? 0,
      actives: toNum(r.actives) ?? 0,
    };
  }
  return out;
}

export interface ScaffoldNeighbour {
  moleculeId: string;
  prefName: string | null;
  pathogenKey: PathogenKey;
  datasetVersion: string;
  split: string | null;
  label: number | null;
  /** True when the two molecules are stereoisomers — same connectivity skeleton. */
  sameSkeleton: boolean;
}

/**
 * Other molecules in the ACTIVE training data that share this one's scaffold.
 *
 * A molecule can sit outside every training set and still be chemistry the
 * model has seen, because a stereoisomer or a close analogue carried the label.
 * The split-integrity fix in the research system removed stereochemistry from
 * the scaffold for exactly this reason; this query surfaces the consequence so
 * a page can report it rather than claim an unseen prediction.
 */
export async function getScaffoldNeighboursInTraining(
  moleculeId: string,
): Promise<ScaffoldNeighbour[]> {
  const self = await queryOne<Record<string, unknown>>(
    `select murcko_scaffold from molecules where molecule_id = ?`,
    [moleculeId],
  );
  const scaffold = self?.murcko_scaffold == null ? null : String(self.murcko_scaffold);
  if (!scaffold) return [];

  const skeleton = moleculeId.split("-")[0];

  const rows = await query<Record<string, unknown>>(
    `select dm.molecule_id, dm.pathogen_key, dm.dataset_version, dm.split, dm.label,
            mo.pref_name
       from dataset_members dm
       join molecules mo on mo.molecule_id = dm.molecule_id
      where mo.murcko_scaffold = ?
        and dm.molecule_id <> ?
        and dm.dataset_version in (
          select distinct dataset_version from model_versions where status = 'ACTIVE')
      order by dm.pathogen_key, dm.molecule_id`,
    [scaffold, moleculeId],
  );

  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    prefName: r.pref_name == null ? null : String(r.pref_name),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    datasetVersion: String(r.dataset_version),
    split: r.split == null ? null : String(r.split),
    label: toNum(r.label),
    sameSkeleton: String(r.molecule_id).split("-")[0] === skeleton,
  }));
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Resolve a generic name to the structure the database holds for it.
 *
 * The case study is about a named medicine, but its identifiers must still come
 * from the database rather than from a constant in the page — the design
 * project, for instance, carries a ChEMBL ID for Levoketoconazole that belongs
 * to an unrelated drug. Resolving by name and reading the identifiers back is
 * what stops that kind of error being copied into the interface.
 */
export async function findMoleculeIdByGenericName(name: string): Promise<string | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select molecule_id from drugs
      where lower(generic_name) = ? and molecule_id is not null
      order by first_seen_at limit 1`,
    [name.toLowerCase()],
  );
  return row?.molecule_id == null ? null : String(row.molecule_id);
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export interface ConditionOption {
  name: string;
  studyCount: number;
}

/**
 * The conditions this medicine's registered studies actually name.
 *
 * Offered as starting points in the Medicine × Condition explorer so that a
 * reader picks from what exists rather than typing a condition and reading an
 * empty result as a negative finding.
 */
export async function getConditionsForMolecule(
  moleculeId: string,
  limit = 24,
): Promise<ConditionOption[]> {
  const rows = await query<Record<string, unknown>>(
    `select conditions, count(*) as n from clinical_trials
      where molecule_id = ? and conditions is not null and conditions <> ''
      group by conditions
      order by n desc
      limit ?`,
    [moleculeId, limit],
  );

  // `conditions` is a delimited list in the source system; split it so a study
  // registered against three conditions offers three starting points.
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
    .map(([name, studyCount]) => ({ name, studyCount }))
    .sort((a, b) => b.studyCount - a.studyCount)
    .slice(0, limit);
}
