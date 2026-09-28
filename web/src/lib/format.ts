/**
 * Registry vocabulary in plain words.
 *
 * ClinicalTrials.gov stores phase and status as enum strings (`PHASE2, PHASE3`,
 * `ACTIVE_NOT_RECRUITING`). They are rewritten for reading, never reinterpreted:
 * a status says where a study is in its life, not whether it worked.
 */

const PHASES: Record<string, string> = {
  EARLY_PHASE1: "Early phase 1",
  PHASE1: "Phase 1",
  PHASE2: "Phase 2",
  PHASE3: "Phase 3",
  PHASE4: "Phase 4",
  NA: "Not applicable",
};

export function formatPhase(value: string | null): string {
  if (!value) return "Not recorded";
  return value
    .split(",")
    .map((part) => PHASES[part.trim()] ?? part.trim())
    .join(" / ");
}

export function formatStatus(value: string | null): string {
  if (!value) return "Not recorded";
  const words = value.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Registry conditions are stored as one `;`-separated string. */
export function splitConditions(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Orange Book names are upper case; set them the way a reader writes them. */
export function medicineName(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s;,/(-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}
