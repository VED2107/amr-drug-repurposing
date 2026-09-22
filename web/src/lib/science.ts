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

import type { EvidenceRung, PathogenKey } from "./types";
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
 * Plain wording for a predicted-activity probability.
 *
 * Describes the prediction, never an outcome: "higher predicted activity",
 * not "more effective".
 */
export function activityBand(value: number | null): {
  wording: string;
  kind: "prediction" | "neutral";
} {
  if (value === null) return { wording: "No prediction available", kind: "neutral" };
  if (value >= 0.75) return { wording: "Higher predicted activity", kind: "prediction" };
  if (value >= 0.5) return { wording: "Moderate predicted activity", kind: "prediction" };
  return { wording: "Lower predicted activity", kind: "neutral" };
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
  kpneumoniae: ["klebsiella"],
  mtb: ["tuberculosis", "mycobacterium tuberculosis", " tb ", "latent tb"],
};

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

/** This project's docking screening target. Not a universal binding cutoff. */
export const DOCKING_SCREENING_TARGET_KCAL_MOL = -7.0;
export const DOCKING_TARGET_LABEL = "Project screening target";

/**
 * The five evidence rungs, with what each one does and does not establish.
 * Copy is carried here so that a rung can never be rendered without it.
 */
export interface RungDefinition {
  key: EvidenceRung;
  label: string;
  /** Colour token name; colour is never the only carrier of meaning. */
  colorVar: string;
  /** A shape, so the rung survives greyscale and colour-blindness. */
  glyph: string;
  means: string;
  not: string;
}

export const RUNGS: readonly RungDefinition[] = [
  {
    key: "clinical",
    label: "Clinical evidence",
    colorVar: "var(--color-clinical)",
    glyph: "◆",
    means: "Registered human studies exist for this medicine and condition.",
    not: "Does not mean the treatment works, was successful, or is approved for this use.",
  },
  {
    key: "experimental",
    label: "Experimental measurement",
    colorVar: "var(--color-experimental)",
    glyph: "■",
    means: "Laboratory activity was measured against this organism and recorded in ChEMBL.",
    not: "Measured in vitro activity does not establish an effect in patients.",
  },
  {
    key: "computational",
    label: "Computational result",
    colorVar: "var(--color-computational)",
    glyph: "▲",
    means: "A model prediction and/or a docking pose exists. Nothing was measured.",
    not: "Does not establish binding, activity, or clinical effectiveness.",
  },
  {
    key: "none",
    label: "No evidence found",
    colorVar: "var(--color-none)",
    glyph: "○",
    means: "The sources were queried and nothing matched this pairing.",
    not: "Absence of a record is not evidence of no effect.",
  },
  {
    key: "unchecked",
    label: "Not yet checked",
    colorVar: "var(--color-unchecked)",
    glyph: "—",
    means: "This pairing has never been queried in this system.",
    not: "Not the same as no evidence found. Nothing has been looked for yet.",
  },
] as const;

export function rung(key: EvidenceRung): RungDefinition {
  const found = RUNGS.find((r) => r.key === key);
  if (!found) throw new Error(`unknown evidence rung: ${key}`);
  return found;
}

/**
 * Classify an evidence record onto a rung.
 *
 * Order matters and the `unchecked` branch comes first: if the pairing was
 * never queried we say so, rather than reporting the absence of records as
 * "no evidence found".
 */
export function classifyRung(input: {
  wasChecked: boolean;
  trialCount: number;
  measuredRecords: number | null;
  hasPrediction: boolean;
  hasDocking: boolean;
}): EvidenceRung {
  if (!input.wasChecked) return "unchecked";
  if (input.trialCount > 0) return "clinical";
  if ((input.measuredRecords ?? 0) > 0) return "experimental";
  if (input.hasPrediction || input.hasDocking) return "computational";
  return "none";
}

/**
 * The resistance-phenotype limitation, in the wording the system is allowed to
 * use. The models are species-level activity models; they do not predict
 * resistance.
 */
export const RESISTANCE_LIMITATION =
  "Resistance phenotype coverage is limited in the underlying data, so the current " +
  "models primarily represent pathogen/species-level activity rather than activity " +
  "against the resistant phenotype.";

/** Shown next to a prediction whose molecule was in the model's training data. */
export const TRAINING_DATA_DISCLOSURE =
  "This molecule was represented in the model's training data, so this score is " +
  "recall rather than an unseen prediction.";

/** Shown for any condition outside the four modelled bacteria. */
export const NO_MODEL_NOTICE =
  "No model exists for this condition. This system only predicts activity against " +
  "MRSA, E. coli, K. pneumoniae and M. tuberculosis. What follows is documented " +
  "evidence, not a prediction.";
