/**
 * What an approved medicine is already used for, as the site shows it.
 *
 * Read from `medicine_indications` (ChEMBL's approved indications, taken from
 * FDA and DailyMed labels), `medicine_classes` (WHO ATC groups and FDA
 * pharmacologic classes) and `medicine_use_status` (the anti-infective
 * classification). Pure: safe on the server and in the browser.
 */

export type UseStatus =
  | "antibacterial"
  | "other_anti_infective"
  | "not_anti_infective"
  | "unclassified";

export interface ExistingUse {
  status: UseStatus | null;
  /** The ATC codes / FDA classes that decided the status. */
  basis: string | null;
  /** Approved indications ChEMBL records from FDA / DailyMed labels. */
  indications: string[];
  /** A label ChEMBL cites for those indications, when it gives one. */
  indicationSource: string | null;
  /** ATC therapeutic groups (level 4), without repeats. */
  atcGroups: string[];
  /** FDA Established Pharmacologic Classes. */
  fdaClasses: string[];
  /** The openFDA label the classes came from, for a DailyMed link. */
  labelSetId: string | null;
}

/** Existing use in one line, from the most specific source that has one. */
export function existingUseText(use: ExistingUse | undefined, max = 4): string | null {
  if (!use) return null;
  const pick = (items: string[]) =>
    items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
  if (use.indications.length) return pick(use.indications.map(sentenceCase));
  if (use.atcGroups.length) return pick(use.atcGroups.map(sentenceCase));
  if (use.fdaClasses.length) return pick(use.fdaClasses);
  return null;
}

function sentenceCase(text: string): string {
  const t = text.trim();
  if (!t) return t;
  // ATC descriptions arrive in capitals; indications in lower case.
  const lowered = t === t.toUpperCase() ? t.toLowerCase() : t;
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

