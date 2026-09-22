/**
 * Domain types for the AMR Research website.
 *
 * These mirror the scientific schema in `data/amr.sqlite` (see
 * `docs/ARCHITECTURE.md`). Field names are preserved from the source system so
 * that a value can always be traced back to the column it came from.
 *
 * Nullability is meaningful here and is never smoothed over. `null` means the
 * source system has no value; it must not be rendered as `0`, as an empty
 * string, or as "none". See `EvidenceRung` for how absence is expressed.
 */

/** The four bacteria that have a trained model. Nothing else may show a probability. */
export type PathogenKey = "mrsa" | "ecoli" | "kpneumoniae" | "mtb";

export const PATHOGEN_KEYS: readonly PathogenKey[] = [
  "mrsa",
  "ecoli",
  "kpneumoniae",
  "mtb",
] as const;

export function isPathogenKey(value: string | null | undefined): value is PathogenKey {
  return value != null && (PATHOGEN_KEYS as readonly string[]).includes(value);
}

/**
 * The five evidence states. These never collapse into one another.
 *
 * In particular `none` ("no evidence found") is not `unchecked`
 * ("not yet checked"), and neither of them means "no effect".
 */
export type EvidenceRung =
  | "clinical"
  | "experimental"
  | "computational"
  | "none"
  | "unchecked";

export interface Pathogen {
  key: PathogenKey;
  label: string;
  fullName: string;
  organism: string;
  taxId: number | null;
  /** Rows in `bioactivity` carrying a label for this pathogen. */
  labelledRecords: number;
  /** Subset of those measured against a named resistant strain. */
  resistantStrainRecords: number;
  /** resistantStrainRecords / labelledRecords. `null` when there are no labels. */
  resistantStrainFraction: number | null;
  activeModelVersion: string | null;
}

export interface Medicine {
  drugId: string;
  /** InChIKey. `null` when the approved product never resolved to a structure. */
  moleculeId: string | null;
  genericName: string;
  brandName: string | null;
  approvalSource: string;
  approvalStatus: string | null;
  applicationNo: string | null;
  applicationType: string | null;
  marketingStatus: string | null;
  dosageForm: string | null;
  route: string | null;
  approvalDate: string | null;
  chemblId: string | null;
  /** How the approved product was linked to a structure. Provenance, not a claim. */
  matchMethod: string | null;
  processingStatus: string;
  predictionStatus: string;
}

export interface MolecularProfile {
  moleculeId: string;
  chemblId: string | null;
  prefName: string | null;
  canonicalSmiles: string | null;
  inchi: string | null;
  inchikey: string | null;
  mw: number | null;
  logp: number | null;
  tpsa: number | null;
  hbd: number | null;
  hba: number | null;
  rotatableBonds: number | null;
  aromaticRings: number | null;
  heavyAtoms: number | null;
  fractionCsp3: number | null;
  qed: number | null;
  lipinskiViolations: number | null;
  murckoScaffold: string | null;
  featureVersion: string | null;
  isValid: boolean;
  validationError: string | null;
}

export interface Prediction {
  moleculeId: string;
  pathogenKey: PathogenKey;
  /** Raw model output in [0,1]. Never rounded before it reaches the component. */
  probability: number;
  modelVersion: string;
  modelType: string | null;
  datasetVersion: string | null;
  featureVersion: string | null;
  predictedAt: string;
  /**
   * Whether this molecule carried a label in the dataset the model trained on.
   *
   * Derived by joining `dataset_members` on (datasetVersion, moleculeId,
   * pathogenKey) — the source system stores membership rather than a flag.
   * `null` means membership could not be determined, which is not the same as
   * `false`.
   */
  inTrainingData: boolean | null;
  /** `train` | `validation` | `test`, when the molecule is in the dataset. */
  trainingSplit: string | null;
  /** The label it carried, when it is in the dataset. */
  trainingLabel: number | null;
}

export interface ModelVersion {
  modelVersion: string;
  pathogenKey: PathogenKey;
  modelType: string;
  isBaseline: boolean;
  datasetVersion: string;
  featureVersion: string;
  trainingDate: string;
  validationMethod: string | null;
  splitMethod: string | null;
  randomSeed: number | null;
  nTrain: number | null;
  nValidation: number | null;
  nTest: number | null;
  metrics: Record<string, number> | null;
  cvMetrics: Record<string, unknown> | null;
  selectionReason: string | null;
  status: string;
  libraryVersions: Record<string, string> | null;
}

export interface DatasetVersion {
  datasetVersion: string;
  createdAt: string;
  nRecords: number | null;
  nCompounds: number | null;
  nPathogens: number | null;
  labeling: Record<string, unknown> | null;
  quality: Record<string, unknown> | null;
  configHash: string | null;
  notes: string | null;
}

export interface DockingTarget {
  targetKey: string;
  pathogenKey: PathogenKey;
  name: string;
  gene: string | null;
  pdbId: string;
  chain: string;
  uniprot: string | null;
  siteMode: string;
  siteReference: string | null;
  structureUrl: string | null;
  status: string;
  selectionNotes: string | null;
}

export interface DockingRun {
  runId: string;
  targetKey: string;
  pathogenKey: PathogenKey;
  engine: string;
  engineVersion: string | null;
  exhaustiveness: number | null;
  numModes: number | null;
  energyRange: number | null;
  randomSeed: number | null;
  box: {
    centerX: number | null;
    centerY: number | null;
    centerZ: number | null;
    sizeX: number | null;
    sizeY: number | null;
    sizeZ: number | null;
  };
  nLigands: number | null;
  nSucceeded: number | null;
  nFailed: number | null;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  error: string | null;
}

export interface DockingResult {
  runId: string;
  moleculeId: string;
  targetKey: string;
  pathogenKey: PathogenKey;
  poseRank: number;
  /** kcal/mol. More negative is a better-scoring pose. Not proof of binding. */
  scoreKcalMol: number | null;
  rmsdLb: number | null;
  rmsdUb: number | null;
  posePath: string | null;
  status: string;
  error: string | null;
}

export interface ClinicalTrial {
  nctId: string;
  moleculeId: string | null;
  queryTerm: string;
  briefTitle: string | null;
  conditions: string[];
  interventions: string[];
  phase: string | null;
  overallStatus: string | null;
  studyType: string | null;
  startDate: string | null;
  completionDate: string | null;
  enrollment: number | null;
  url: string | null;
  amrRelated: boolean;
  matchedKeywords: string[];
  retrievedAt: string;
}

/** One row of `clinical_queries`: whether this molecule was ever asked about. */
export interface ClinicalQuery {
  moleculeId: string;
  queryTerm: string;
  nResults: number;
  nAmr: number;
  status: string;
  error: string | null;
  retrievedAt: string;
}

export interface Condition {
  name: string;
  normalizedName: string;
  source: string;
  studyCount: number;
  /** `null` when no model covers this condition — the percentage gate closes. */
  modelledPathogenKey: PathogenKey | null;
}

/**
 * The evidence record for one medicine × one condition.
 *
 * `wasChecked === false` produces the `unchecked` rung and must never be
 * rendered as "no evidence found".
 */
export interface EvidenceRecord {
  moleculeId: string;
  medicineName: string;
  condition: string;
  modelledPathogenKey: PathogenKey | null;
  wasChecked: boolean;
  checkedAt: string | null;
  prediction: Prediction | null;
  /** Count of labelled bioactivity measurements. `null` when never queried. */
  measuredRecords: number | null;
  bestDocking: DockingResult | null;
  trials: ClinicalTrial[];
  trialCount: number;
  rung: EvidenceRung;
}

export interface PipelineRun {
  runId: string;
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  status: string;
  recordsProcessed: number;
  recordsNew: number;
  recordsSkipped: number;
  errorCount: number;
  message: string | null;
}

export interface PipelineError {
  runId: string;
  stage: string;
  subject: string | null;
  errorType: string | null;
  message: string | null;
  createdAt: string;
}

export interface DataSource {
  name: string;
  url: string | null;
  sourceVersion: string | null;
  retrievedAt: string;
  recordCount: number | null;
  notes: string | null;
}

/** Headline counts for the dashboard. Every field is a live COUNT, never a constant. */
export interface CoverageSummary {
  approvedMedicines: number;
  validStructures: number;
  distinctStudies: number;
  trialLinks: number;
  storedPoses: number;
  labelledBioactivity: number;
  activePredictions: number;
  activeModels: number;
  /** Medicines queried against ClinicalTrials.gov out of the approved library. */
  clinicalChecked: number;
  clinicalTotal: number;
  /** Medicines with at least one stored pose, out of the approved library. */
  dockedMedicines: number;
}
