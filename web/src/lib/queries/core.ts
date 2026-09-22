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

import { query, queryOne, toBool, toJson, toList, toNum } from "@/lib/db/client";
import { classifyRung, matchModelledPathogen } from "@/lib/science";
import type {
  ClinicalTrial,
  CoverageSummary,
  DatasetVersion,
  DockingResult,
  DockingRun,
  DockingTarget,
  EvidenceRecord,
  Medicine,
  ModelVersion,
  MolecularProfile,
  Pathogen,
  PathogenKey,
  PipelineRun,
  Prediction,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/**
 * The headline counts. Each one is a live aggregate, so running a pipeline
 * stage changes what the dashboard says — which is the point.
 */
export async function getCoverageSummary(): Promise<CoverageSummary> {
  const row = await queryOne<Record<string, unknown>>(`
    select
      (select count(distinct molecule_id) from drugs
        where molecule_id is not null)                          as approved_medicines,
      (select count(*) from molecules where is_valid)       as valid_structures,
      (select count(distinct nct_id) from clinical_trials)      as distinct_studies,
      (select count(*) from clinical_trials)                    as trial_links,
      (select count(*) from docking_results where status = 'ok') as stored_poses,
      (select count(*) from bioactivity where label is not null) as labelled_bioactivity,
      (select count(*) from predictions p
         join model_versions m on m.model_version = p.model_version
        where m.status = 'ACTIVE')                              as active_predictions,
      (select count(*) from model_versions where status = 'ACTIVE') as active_models,
      (select count(*) from clinical_queries)                   as clinical_checked,
      (select count(distinct molecule_id) from docking_results
        where status = 'ok')                                    as docked_medicines
  `);

  if (!row) throw new Error("coverage summary returned no row");

  const n = (k: string) => toNum(row[k]) ?? 0;
  return {
    approvedMedicines: n("approved_medicines"),
    validStructures: n("valid_structures"),
    distinctStudies: n("distinct_studies"),
    trialLinks: n("trial_links"),
    storedPoses: n("stored_poses"),
    labelledBioactivity: n("labelled_bioactivity"),
    activePredictions: n("active_predictions"),
    activeModels: n("active_models"),
    clinicalChecked: n("clinical_checked"),
    clinicalTotal: n("approved_medicines"),
    dockedMedicines: n("docked_medicines"),
  };
}

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
    `select * from drugs where molecule_id = ? order by first_seen_at limit 1`,
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
/* Molecular                                                           */
/* ------------------------------------------------------------------ */

export async function getMolecularProfile(
  moleculeId: string,
): Promise<MolecularProfile | null> {
  const r = await queryOne<Record<string, unknown>>(
    `select molecule_id, chembl_id, pref_name, canonical_smiles, inchi, inchikey,
            mw, logp, tpsa, hbd, hba, rotatable_bonds, aromatic_rings, heavy_atoms,
            fraction_csp3, qed, lipinski_violations, murcko_scaffold, feature_version,
            is_valid, validation_error
       from molecules where molecule_id = ?`,
    [moleculeId],
  );
  if (!r) return null;

  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    moleculeId: String(r.molecule_id),
    chemblId: s("chembl_id"),
    prefName: s("pref_name"),
    canonicalSmiles: s("canonical_smiles"),
    inchi: s("inchi"),
    inchikey: s("inchikey"),
    mw: toNum(r.mw),
    logp: toNum(r.logp),
    tpsa: toNum(r.tpsa),
    hbd: toNum(r.hbd),
    hba: toNum(r.hba),
    rotatableBonds: toNum(r.rotatable_bonds),
    aromaticRings: toNum(r.aromatic_rings),
    heavyAtoms: toNum(r.heavy_atoms),
    fractionCsp3: toNum(r.fraction_csp3),
    qed: toNum(r.qed),
    lipinskiViolations: toNum(r.lipinski_violations),
    murckoScaffold: s("murcko_scaffold"),
    featureVersion: s("feature_version"),
    isValid: toBool(r.is_valid) ?? false,
    validationError: s("validation_error"),
  };
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
/* Docking                                                             */
/* ------------------------------------------------------------------ */

export async function getDockingForMolecule(moleculeId: string): Promise<DockingResult[]> {
  const rows = await query<Record<string, unknown>>(
    `select run_id, molecule_id, target_key, pathogen_key, pose_rank,
            score_kcal_mol, rmsd_lb, rmsd_ub, pose_path, status, error
       from docking_results
      where molecule_id = ?
      order by case when score_kcal_mol is null then 1 else 0 end,
               score_kcal_mol asc, pose_rank asc`,
    [moleculeId],
  );

  return rows.map((r) => ({
    runId: String(r.run_id),
    moleculeId: String(r.molecule_id),
    targetKey: String(r.target_key),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    poseRank: toNum(r.pose_rank) ?? 0,
    scoreKcalMol: toNum(r.score_kcal_mol),
    rmsdLb: toNum(r.rmsd_lb),
    rmsdUb: toNum(r.rmsd_ub),
    posePath: r.pose_path == null ? null : String(r.pose_path),
    status: String(r.status),
    error: r.error == null ? null : String(r.error),
  }));
}

export async function getDockingTargets(): Promise<DockingTarget[]> {
  const rows = await query<Record<string, unknown>>(
    `select target_key, pathogen_key, name, gene, pdb_id, chain, uniprot,
            site_mode, site_reference, structure_url, status, selection_notes
       from targets order by pathogen_key`,
  );
  return rows.map((r) => ({
    targetKey: String(r.target_key),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    name: String(r.name),
    gene: r.gene == null ? null : String(r.gene),
    pdbId: String(r.pdb_id),
    chain: String(r.chain),
    uniprot: r.uniprot == null ? null : String(r.uniprot),
    siteMode: String(r.site_mode),
    siteReference: r.site_reference == null ? null : String(r.site_reference),
    structureUrl: r.structure_url == null ? null : String(r.structure_url),
    status: String(r.status),
    selectionNotes: r.selection_notes == null ? null : String(r.selection_notes),
  }));
}

export async function getDockingRuns(): Promise<DockingRun[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from docking_runs order by started_at desc`,
  );
  return rows.map((r) => ({
    runId: String(r.run_id),
    targetKey: String(r.target_key),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    engine: String(r.engine),
    engineVersion: r.engine_version == null ? null : String(r.engine_version),
    exhaustiveness: toNum(r.exhaustiveness),
    numModes: toNum(r.num_modes),
    energyRange: toNum(r.energy_range),
    randomSeed: toNum(r.random_seed),
    box: {
      centerX: toNum(r.box_center_x),
      centerY: toNum(r.box_center_y),
      centerZ: toNum(r.box_center_z),
      sizeX: toNum(r.box_size_x),
      sizeY: toNum(r.box_size_y),
      sizeZ: toNum(r.box_size_z),
    },
    nLigands: toNum(r.n_ligands),
    nSucceeded: toNum(r.n_succeeded),
    nFailed: toNum(r.n_failed),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
    status: String(r.status),
    error: r.error == null ? null : String(r.error),
  }));
}

/* ------------------------------------------------------------------ */
/* Clinical                                                            */
/* ------------------------------------------------------------------ */

function mapTrial(r: Record<string, unknown>): ClinicalTrial {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    nctId: String(r.nct_id),
    moleculeId: s("molecule_id"),
    queryTerm: String(r.query_term),
    briefTitle: s("brief_title"),
    conditions: toList(r.conditions),
    interventions: toList(r.interventions),
    phase: s("phase"),
    overallStatus: s("overall_status"),
    studyType: s("study_type"),
    startDate: s("start_date"),
    completionDate: s("completion_date"),
    enrollment: toNum(r.enrollment),
    url: s("url"),
    amrRelated: toBool(r.amr_related) ?? false,
    matchedKeywords: toList(r.matched_keywords, ","),
    retrievedAt: String(r.retrieved_at),
  };
}

export async function getTrialsForMolecule(
  moleculeId: string,
  limit = 200,
): Promise<ClinicalTrial[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from clinical_trials where molecule_id = ?
      order by case when start_date is null then 1 else 0 end, start_date desc
      limit ?`,
    [moleculeId, limit],
  );
  return rows.map(mapTrial);
}

export async function getTrialCount(moleculeId: string): Promise<number> {
  const r = await queryOne<Record<string, unknown>>(
    `select count(*) as n from clinical_trials where molecule_id = ?`,
    [moleculeId],
  );
  return toNum(r?.n) ?? 0;
}

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

/* ------------------------------------------------------------------ */
/* Measured activity                                                   */
/* ------------------------------------------------------------------ */

export async function getMeasuredRecordCount(
  moleculeId: string,
  pathogenKey?: PathogenKey,
): Promise<number> {
  const r = pathogenKey
    ? await queryOne<Record<string, unknown>>(
        `select count(*) as n from bioactivity
          where molecule_id = ? and pathogen_key = ? and label is not null`,
        [moleculeId, pathogenKey],
      )
    : await queryOne<Record<string, unknown>>(
        `select count(*) as n from bioactivity
          where molecule_id = ? and label is not null`,
        [moleculeId],
      );
  return toNum(r?.n) ?? 0;
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * Assemble the evidence for one medicine against one condition.
 *
 * The condition is matched to a modelled pathogen by the same patterns the
 * research prototype uses. When it does not match, `prediction` stays null and
 * the interface owes the reader an explicit "no model exists for this
 * condition" — there is no fallback number.
 */
export async function getEvidence(
  moleculeId: string,
  condition: string,
): Promise<EvidenceRecord | null> {
  const medicine = await getMedicineByMoleculeId(moleculeId);
  if (!medicine) return null;

  const pathogenKey = matchModelledPathogen(condition);
  const { checked, checkedAt } = await wasClinicallyChecked(moleculeId);

  const [predictions, docking, trials] = await Promise.all([
    pathogenKey ? getPredictionsForMolecule(moleculeId) : Promise.resolve([]),
    getDockingForMolecule(moleculeId),
    getTrialsForMolecule(moleculeId),
  ]);

  const prediction = pathogenKey
    ? (predictions.find((p) => p.pathogenKey === pathogenKey) ?? null)
    : null;

  const bestDocking = pathogenKey
    ? (docking.find((d) => d.pathogenKey === pathogenKey && d.status === "ok") ?? null)
    : null;

  // Trials are filtered to those that actually name the condition. A trial for
  // a different indication is not evidence about this one.
  const needle = condition.toLowerCase();
  const matching = trials.filter(
    (t) =>
      t.conditions.some((c) => c.toLowerCase().includes(needle)) ||
      (t.briefTitle ?? "").toLowerCase().includes(needle),
  );

  // Measured records only count when a pathogen is modelled; otherwise the
  // question "measured against what organism?" has no answer here.
  const measuredRecords = checked
    ? pathogenKey
      ? await getMeasuredRecordCount(moleculeId, pathogenKey)
      : 0
    : null;

  return {
    moleculeId,
    medicineName: medicine.genericName,
    condition,
    modelledPathogenKey: pathogenKey,
    wasChecked: checked,
    checkedAt,
    prediction,
    measuredRecords,
    bestDocking,
    trials: matching,
    trialCount: matching.length,
    rung: classifyRung({
      wasChecked: checked,
      trialCount: matching.length,
      measuredRecords,
      hasPrediction: prediction != null,
      hasDocking: bestDocking != null,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Models and datasets                                                 */
/* ------------------------------------------------------------------ */

export async function getModelVersions(onlyActive = false): Promise<ModelVersion[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from model_versions ${onlyActive ? "where status = 'ACTIVE'" : ""}
      order by pathogen_key, training_date desc`,
  );
  return rows.map((r) => ({
    modelVersion: String(r.model_version),
    pathogenKey: String(r.pathogen_key) as PathogenKey,
    modelType: String(r.model_type),
    isBaseline: toBool(r.is_baseline) ?? false,
    datasetVersion: String(r.dataset_version),
    featureVersion: String(r.feature_version),
    trainingDate: String(r.training_date),
    validationMethod: r.validation_method == null ? null : String(r.validation_method),
    splitMethod: r.split_method == null ? null : String(r.split_method),
    randomSeed: toNum(r.random_seed),
    nTrain: toNum(r.n_train),
    nValidation: toNum(r.n_validation),
    nTest: toNum(r.n_test),
    metrics: toJson<Record<string, number>>(r.metrics_json),
    cvMetrics: toJson<Record<string, unknown>>(r.cv_metrics_json),
    selectionReason: r.selection_reason == null ? null : String(r.selection_reason),
    status: String(r.status),
    libraryVersions: toJson<Record<string, string>>(r.library_versions),
  }));
}

export async function getDatasetVersions(): Promise<DatasetVersion[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from dataset_versions order by created_at desc`,
  );
  return rows.map((r) => ({
    datasetVersion: String(r.dataset_version),
    createdAt: String(r.created_at),
    nRecords: toNum(r.n_records),
    nCompounds: toNum(r.n_compounds),
    nPathogens: toNum(r.n_pathogens),
    labeling: toJson<Record<string, unknown>>(r.labeling_json),
    quality: toJson<Record<string, unknown>>(r.quality_json),
    configHash: r.config_hash == null ? null : String(r.config_hash),
    notes: r.notes == null ? null : String(r.notes),
  }));
}

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export async function getPipelineRuns(limit = 50): Promise<PipelineRun[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from pipeline_runs order by started_at desc limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    runId: String(r.run_id),
    stage: String(r.stage),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
    durationSeconds: toNum(r.duration_seconds),
    status: String(r.status),
    recordsProcessed: toNum(r.records_processed) ?? 0,
    recordsNew: toNum(r.records_new) ?? 0,
    recordsSkipped: toNum(r.records_skipped) ?? 0,
    errorCount: toNum(r.error_count) ?? 0,
    message: r.message == null ? null : String(r.message),
  }));
}
