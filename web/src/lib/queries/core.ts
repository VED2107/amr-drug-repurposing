import "server-only";

/**
 * Typed queries over the research database.
 *
 * Every function here returns rows that exist. None of them substitute a
 * default for a missing value, and none of them round a scientific quantity —
 * formatting happens at the component boundary, where the label travels with
 * the number.
 *
 * The SQL is written in the subset SQLite and Postgres both accept so that a
 * single statement serves local development, the integrity tests and
 * production. See `src/lib/db/client.ts` for why.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import type { Medicine, Pathogen, PathogenKey, Prediction } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Pathogens                                                           */
/* ------------------------------------------------------------------ */

/**
 * The four modelled bacteria, with the resistance coverage that limits what
 * their models may be said to represent.
 *
 * `resistantStrainFraction` is null rather than zero when a pathogen has no
 * labelled records at all: "no labels" and "no resistant labels" are different
 * statements and the interface says which one it is.
 */
export async function getPathogens(): Promise<Pathogen[]> {
  const rows = await query<Record<string, unknown>>(`
    select
      p.key,
      p.label,
      p.full_name,
      p.organism,
      p.tax_id,
      (select count(*) from bioactivity b
        where b.pathogen_key = p.key and b.label is not null)     as labelled_records,
      (select count(*) from bioactivity b
        where b.pathogen_key = p.key and b.label is not null
          and b.strain_specific)                              as resistant_records,
      (select m.model_version from model_versions m
        where m.pathogen_key = p.key and m.status = 'ACTIVE'
        order by m.training_date desc limit 1)                    as active_model_version
    from pathogens p
    order by p.key
  `);

  return rows.map((r) => {
    const labelled = toNum(r.labelled_records) ?? 0;
    const resistant = toNum(r.resistant_records) ?? 0;
    return {
      key: String(r.key) as PathogenKey,
      label: String(r.label),
      fullName: String(r.full_name),
      organism: String(r.organism),
      taxId: toNum(r.tax_id),
      labelledRecords: labelled,
      resistantStrainRecords: resistant,
      resistantStrainFraction: labelled === 0 ? null : resistant / labelled,
      activeModelVersion: r.active_model_version ? String(r.active_model_version) : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Medicines                                                           */
/* ------------------------------------------------------------------ */

function mapMedicine(r: Record<string, unknown>): Medicine {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    drugId: String(r.drug_id),
    moleculeId: s("molecule_id"),
    genericName: String(r.generic_name),
    brandName: s("brand_name"),
    approvalSource: String(r.approval_source),
    approvalStatus: s("approval_status"),
    applicationNo: s("application_no"),
    applicationType: s("application_type"),
    marketingStatus: s("marketing_status"),
    dosageForm: s("dosage_form"),
    route: s("route"),
    approvalDate: s("approval_date"),
    chemblId: s("chembl_id"),
    matchMethod: s("match_method"),
    processingStatus: String(r.processing_status),
    predictionStatus: String(r.prediction_status),
  };
}

export async function getMedicineByMoleculeId(moleculeId: string): Promise<Medicine | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select * from drugs where molecule_id = ?
      order by length(generic_name), generic_name, drug_id limit 1`,
    [moleculeId],
  );
  return row ? mapMedicine(row) : null;
}

/** Every approved product that shares one structure (brands of one molecule). */
export async function getBrandsForMolecule(moleculeId: string): Promise<Medicine[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from drugs where molecule_id = ? order by generic_name, brand_name`,
    [moleculeId],
  );
  return rows.map(mapMedicine);
}

/* ------------------------------------------------------------------ */
/* Predictions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Predictions from ACTIVE models for one molecule, with training-data
 * membership attached.
 *
 * `inTrainingData` is three-valued. `null` means the prediction carries no
 * dataset version so membership cannot be established — which is not the same
 * as the molecule being absent from the training data, and is not rendered as
 * though it were.
 */
export async function getPredictionsForMolecule(moleculeId: string): Promise<Prediction[]> {
  const rows = await query<Record<string, unknown>>(
    `select p.molecule_id, p.pathogen_key, p.probability, p.model_version,
            p.model_type, p.dataset_version, p.feature_version, p.predicted_at,
            dm.molecule_id as member_id, dm.split as training_split,
            dm.label as training_label
       from predictions p
       join model_versions m
         on m.model_version = p.model_version and m.status = 'ACTIVE'
       left join dataset_members dm
         on dm.dataset_version = p.dataset_version
        and dm.molecule_id     = p.molecule_id
        and dm.pathogen_key    = p.pathogen_key
      where p.molecule_id = ?
      order by p.probability desc`,
    [moleculeId],
  );

  return rows.map((r) => ({
    moleculeId: String(r.molecule_id),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    probability: toNum(r.probability) as number,
    modelVersion: String(r.model_version),
    modelType: r.model_type == null ? null : String(r.model_type),
    datasetVersion: r.dataset_version == null ? null : String(r.dataset_version),
    featureVersion: r.feature_version == null ? null : String(r.feature_version),
    predictedAt: String(r.predicted_at),
    inTrainingData: r.dataset_version == null ? null : r.member_id != null,
    trainingSplit: r.training_split == null ? null : String(r.training_split),
    trainingLabel: toNum(r.training_label),
  }));
}

/* ------------------------------------------------------------------ */
/* Clinical and laboratory                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether this molecule has ever been queried at the registry.
 *
 * This is the distinction between "no evidence found" and "not yet checked",
 * and it is a row's existence rather than a flag, so it cannot be faked.
 */
export async function wasClinicallyChecked(
  moleculeId: string,
): Promise<{ checked: boolean; checkedAt: string | null }> {
  const r = await queryOne<Record<string, unknown>>(
    `select retrieved_at from clinical_queries where molecule_id = ?`,
    [moleculeId],
  );
  return { checked: r != null, checkedAt: r ? String(r.retrieved_at) : null };
}

/** Labelled laboratory records for this molecule, per pathogen. */
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
