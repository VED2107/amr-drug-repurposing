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
      "An acid-fast pathogen whose waxy envelope, rich in mycolic acids, keeps many drugs from reaching the cell.",
  },
};

/**
 * Well-known repurposing stories, from the project presentation. Halicin is the
 * odd one out and says so: never approved, its antimicrobial activity was
 * identified by deep learning (Stokes et al., Cell, 2020), the idea this
 * project applies to approved medicines.
 */
export const REPURPOSING_EXAMPLES: {
  name: string;
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
  note?: string;
}[] = [
  { name: "Aspirin", from: "Pain and fever", to: "Preventing heart attacks and strokes" },
  { name: "Sildenafil", from: "Chest pain (angina)", to: "Erectile dysfunction" },
  {
    // Stokes et al., Cell 2020;180:688, doi:10.1016/j.cell.2020.01.021: "the
    // c-Jun N-terminal kinase inhibitor SU3327 (renamed halicin), a
    // preclinical nitrothiazole under investigation as a treatment for diabetes."
    name: "Halicin",
    fromLabel: "First studied for",
    from: "Diabetes, as the preclinical compound SU3327",
    toLabel: "Identified by deep learning",
    to: "Antimicrobial activity (2020)",
    note: "Not an approved medicine; it was preclinical when identified.",
  },
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
    line: "Dock every medicine against a protein from each pathogen",
    note: "Docking estimates how a molecule may fit within a selected protein binding site.",
    evidence: "computational",
    evidenceLabel: "Computer prediction",
  },
  {
    verb: "Check evidence",
    line: "Search registered clinical studies and other evidence",
    note: "This tells us what has already been studied, not whether a new antimicrobial use works.",
    evidence: "clinical",
    evidenceLabel: "Clinical record",
  },
];
