/**
 * Editorial copy that is not data: plain descriptions for readers who study
 * pharmacy or medicine. Nothing here is a count; counts come from the database.
 */

import type { PathogenKey } from "./types";

/** The four bacteria, in the words a pharmacy student would use. */
export const PATHOGEN_PLAIN: Record<PathogenKey, { plain: string; mechanism: string }> = {
  mrsa: {
    plain: "A skin and bloodstream bacterium that no longer responds to methicillin-type antibiotics.",
    mechanism: "Makes an altered penicillin-binding protein (PBP2a), so beta-lactams cannot bind.",
  },
  ecoli: {
    plain: "A gut bacterium behind many urinary and bloodstream infections.",
    mechanism: "Resistant strains make beta-lactamase enzymes and pump drugs back out of the cell.",
  },
  kpneumoniae: {
    plain: "A hospital bacterium; some strains resist nearly every antibiotic available.",
    mechanism: "Carbapenemase enzymes (such as KPC) break down carbapenems, the drugs of last resort.",
  },
  mtb: {
    plain: "The cause of tuberculosis. Drug-resistant TB can need years of treatment.",
    mechanism: "A thick, waxy cell wall keeps many drugs out, and mutations disable others.",
  },
};

/** Well-known repurposing stories, from the project presentation. */
export const REPURPOSING_EXAMPLES: { name: string; from: string; to: string }[] = [
  { name: "Aspirin", from: "Pain and fever", to: "Preventing heart attacks and strokes" },
  { name: "Sildenafil", from: "Chest pain (angina)", to: "Erectile dysfunction" },
  { name: "Thalidomide", from: "Morning sickness (1950s)", to: "Leprosy complications and multiple myeloma" },
];
