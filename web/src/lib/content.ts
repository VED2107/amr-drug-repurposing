/**
 * Editorial copy that is not data, taken from the project presentation
 * ("Smart Screening", 12 slides). The deck is the source of truth for wording;
 * nothing here is a count. Counts come from the database.
 */

import type { PathogenKey } from "./types";

/**
 * The four species, as slide 5 of the presentation shows them: the
 * scientific name, the classification, the resistance feature, and (from the
 * speaker notes) where that feature sits.
 */
export const ORGANISMS: Record<
  PathogenKey,
  {
    scientific: string;
    classification: string;
    resistanceLabel: string;
    resistance: string;
    /** The speaker notes, in plain words. */
    detail: string;
  }
> = {
  mrsa: {
    scientific: "Staphylococcus aureus",
    classification: "Gram-positive",
    resistanceLabel: "Resistance example",
    resistance: "Altered PBP2a target",
    detail:
      "MRSA carries an altered target, PBP2a, so beta-lactam antibiotics bind it poorly. The thick wall of a Gram-positive cell surrounds it.",
  },
  ecoli: {
    scientific: "Escherichia coli",
    classification: "Gram-negative",
    resistanceLabel: "Resistance examples",
    resistance: "Outer membrane + drug efflux",
    detail:
      "An outer membrane limits what gets in, and efflux pumps push drugs that do enter back out of the cell.",
  },
  kpneumoniae: {
    scientific: "Klebsiella pneumoniae",
    classification: "Gram-negative",
    resistanceLabel: "Resistance example",
    resistance: "Carbapenemase enzymes",
    detail:
      "An outer membrane limits entry, and some strains produce carbapenemase enzymes that destroy carbapenems, the drugs kept for last resort.",
  },
  mtb: {
    scientific: "Mycobacterium tuberculosis",
    classification: "Acid-fast",
    resistanceLabel: "Resistance-related structural feature",
    resistance: "Waxy mycolic-acid-rich cell envelope",
    detail:
      "An acid-fast bacterium whose waxy envelope, rich in mycolic acids, keeps many drugs from reaching the cell.",
  },
};

/** Well-known repurposing stories, from the project presentation. */
export const REPURPOSING_EXAMPLES: { name: string; from: string; to: string }[] = [
  { name: "Aspirin", from: "Pain and fever", to: "Preventing heart attacks and strokes" },
  { name: "Sildenafil", from: "Chest pain (angina)", to: "Erectile dysfunction" },
  { name: "Thalidomide", from: "Morning sickness (1950s)", to: "Leprosy complications and multiple myeloma" },
];

/** Slide 6: the five stages, from molecule to evidence. */
export const PIPELINE: {
  verb: string;
  line: string;
  note?: string;
  evidence: "experimental" | "computational" | "clinical";
  evidenceLabel: string;
}[] = [
  {
    verb: "Collect",
    line: "Approved medicines + laboratory activity records",
    evidence: "experimental",
    evidenceLabel: "Lab measurement",
  },
  {
    verb: "Represent",
    line: "Convert molecular structures into machine-readable patterns",
    note: "The computer needs a numerical representation of a molecule before it can compare molecular patterns.",
    evidence: "computational",
    evidenceLabel: "Molecular fingerprint",
  },
  {
    verb: "Predict",
    line: "The model estimates activity from the project's laboratory activity data",
    note: "A pattern learned from earlier laboratory observations. It is not a diagnosis.",
    evidence: "computational",
    evidenceLabel: "AI-predicted activity",
  },
  {
    verb: "Check fit",
    line: "Dock selected molecules against bacterial proteins",
    note: "Docking estimates how a molecule may fit within a selected protein binding site.",
    evidence: "computational",
    evidenceLabel: "Computer prediction",
  },
  {
    verb: "Check evidence",
    line: "Search registered clinical studies and other evidence",
    note: "This tells us what has already been studied, not whether a new antibacterial use works.",
    evidence: "clinical",
    evidenceLabel: "Clinical record",
  },
];
