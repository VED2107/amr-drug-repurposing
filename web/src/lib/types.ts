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

/** The four pathogens that have a trained model. Nothing else may show a probability. */
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
