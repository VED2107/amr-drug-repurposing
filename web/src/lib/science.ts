/**
 * The scientific rules the interface is not allowed to break.
 *
 * This is a direct port of `app/components/explain.py` and the pathogen gate in
 * `app/data.py` from the research prototype. The behaviour is deliberately
 * identical: the prototype's test suite pins these rules, and the website
 * inherits them rather than reimplementing them by eye.
 *
 * Everything here is pure and runs on the server as happily as the client.
 */

import type { PathogenKey } from "./types";
import { isPathogenKey } from "./types";

/**
 * Labels that would misrepresent a model probability as a clinical outcome.
 * Mirrors `FORBIDDEN_PERCENT_LABELS`.
 */
export const FORBIDDEN_PERCENT_LABELS = [
  "effectiveness",
  "effective",
  "success",
  "cure",
  "cured",
  "efficacy",
  "chance of curing",
  "clinical success",
  "will treat",
  "guaranteed",
] as const;

/** Thrown when a percentage is given a label that implies clinical benefit. */
export class MisleadingLabelError extends Error {
  constructor(label: string) {
    super(
      `percentage label ${JSON.stringify(label)} implies clinical benefit; ` +
        "this system predicts antibacterial activity, it does not establish efficacy",
    );
    this.name = "MisleadingLabelError";
  }
}

export function assertHonestLabel(label: string): void {
  const lowered = label.toLowerCase();
  for (const banned of FORBIDDEN_PERCENT_LABELS) {
    if (lowered.includes(banned)) {
      throw new MisleadingLabelError(label);
    }
  }
}

/**
 * A probability as text, without ever implying certainty.
 *
 * A random forest returns 1.0 when every tree votes the same way. That is
 * unanimity among the trees, not certainty about the world, so saturated values
 * read as ">99%" and "<1%" rather than "100%" and "0%".
 */
export function formatProbability(value: number | null, decimals = 0): string {
  if (value === null || Number.isNaN(value)) return "—";
  const fraction = Math.max(0, Math.min(1, value));
  if (fraction >= 0.995) return ">99%";
  if (fraction <= 0.005 && fraction > 0) return "<1%";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/**
 * Condition text → the pathogen this system models, or `null`.
 *
 * This is the gate on percentages. Mirrors `AMR_DISEASE_PATTERNS` and
 * `match_modelled_pathogen()` exactly, including the surrounding-space trick
 * that stops " tb " matching inside words.
 */
const AMR_DISEASE_PATTERNS: Record<PathogenKey, readonly string[]> = {
  mrsa: [
    "mrsa",
    "methicillin-resistant",
    "methicillin resistant",
    "staphylococcus aureus",
    "staph aureus",
  ],
  ecoli: ["escherichia coli", "e. coli", "e coli"],
  kpneumoniae: ["klebsiella", "k. pneumoniae", "k pneumoniae"],
  mtb: ["tuberculosis", "mycobacterium tuberculosis", " tb ", "latent tb"],
};

/**
 * The words a registered study's conditions must contain to count as being
 * about a modelled pathogen. The same patterns as the gate, so "documented for
 * this condition" and "a model exists for this condition" can never disagree.
 */
export function pathogenConditionTerms(key: PathogenKey): readonly string[] {
  return AMR_DISEASE_PATTERNS[key];
}

export function matchModelledPathogen(disease: string | null | undefined): PathogenKey | null {
  if (!disease) return null;
  const text = ` ${disease.toLowerCase()} `;
  for (const key of Object.keys(AMR_DISEASE_PATTERNS) as PathogenKey[]) {
    if (AMR_DISEASE_PATTERNS[key].some((p) => text.includes(p))) return key;
  }
  return null;
}

/**
 * Whether a probability may be displayed at all.
 *
 * A probability requires a modelled pathogen AND a real value. There is no
 * fallback number, no extrapolation and no "estimated".
 */
export function mayShowProbability(
  pathogenKey: string | null | undefined,
  value: number | null | undefined,
): value is number {
  return isPathogenKey(pathogenKey) && typeof value === "number" && !Number.isNaN(value);
}

/** The one permitted label for a model probability. */
export const ACTIVITY_LABEL = "AI-predicted activity";

/**
 * The website's discovery floor: a medicine counts as having AI-predicted
 * activity against a pathogen, and can be listed among the other medicines to
 * investigate, when the ACTIVE model's probability is at or above this.
 *
 * This belongs to the website only. It is not the models' decision boundary
 * and not the pipeline's candidate threshold (`configs/config.yaml`), and
 * neither is changed by it. Every medicine has a prediction for every
 * pathogen, so without a floor every medicine would count.
 */
export const DISCOVERY_THRESHOLD = 0.4;

/** The floor as the reader sees it: "≥40%". */
export const DISCOVERY_THRESHOLD_TEXT = `≥${Math.round(DISCOVERY_THRESHOLD * 100)}%`;

/** This project's docking screening target. Not a universal binding cutoff. */
export const DOCKING_SCREENING_TARGET_KCAL_MOL = -7.0;

/** Shown for any condition outside the four modelled bacteria. */
export const NO_MODEL_NOTICE =
  "No AI activity model is currently available for this condition. Predictions exist " +
  "only for MRSA, E. coli, K. pneumoniae and M. tuberculosis, so no percentage is shown.";
