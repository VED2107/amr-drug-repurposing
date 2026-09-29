import "server-only";

/**
 * The two public downloads: the whole approved-medicine library, and the
 * repurposing candidates within it.
 *
 * Both are built from `getLibraryRecords`, and the candidate file keeps exactly
 * the records `candidateFilter` marks — the same definition behind every count
 * on the site. Only public research data goes in: names, public identifiers
 * (ChEMBL, FDA application numbers, InChIKey), classifications, predictions and
 * evidence counts. No connection detail, model file, dataset id or internal
 * row id is ever written.
 */

import { existingUseText, getLibraryRecords, type LibraryRecord } from "@/lib/queries/repurposing";
import { DISCOVERY_THRESHOLD, DISCOVERY_THRESHOLD_TEXT } from "@/lib/science";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";

const PATHOGEN_COLUMN: Record<PathogenKey, string> = {
  mrsa: "MRSA",
  ecoli: "E. coli",
  kpneumoniae: "K. pneumoniae",
  mtb: "M. tuberculosis",
};

const STATUS_TEXT: Record<string, string> = {
  antibacterial: "Existing antibacterial",
  other_anti_infective: "Other anti-infective (not antibacterial)",
  not_anti_infective: "Not an anti-infective",
  unclassified: "Unclassified (needs review)",
};

/** A spreadsheet cell, quoted, and never read as a formula. */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  // A byte-order mark so spreadsheet software reads the file as UTF-8.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const pct = (p: number | undefined) => (p === undefined ? null : Number((p * 100).toFixed(1)));

function qualifying(r: LibraryRecord): PathogenKey[] {
  return PATHOGEN_KEYS.filter((k) => (r.predictions[k] ?? -1) >= DISCOVERY_THRESHOLD);
}

function evidenceText(r: LibraryRecord): string {
  const parts: string[] = [];
  if (r.labRecords > 0) parts.push("laboratory records");
  if (r.studies > 0) parts.push("registered studies");
  if (parts.length) return parts.join("; ");
  return r.registryChecked ? "no evidence found" : "not yet checked";
}

const PREDICTION_HEADERS = PATHOGEN_KEYS.map((k) => `AI-predicted activity: ${PATHOGEN_COLUMN[k]} (%)`);

export async function approvedMedicinesCsv(): Promise<{ csv: string; rows: number }> {
  const records = await getLibraryRecords();
  const header = [
    "Medicine",
    "Brand names",
    "InChIKey",
    "ChEMBL ID",
    "FDA applications",
    "Earliest FDA approval date in Orange Book",
    "Existing / approved use",
    "WHO ATC therapeutic groups",
    "FDA pharmacologic classes",
    "Anti-infective classification",
    "Existing antibacterial (true / false / unclassified)",
    "Classification basis",
    "Structure available",
    ...PREDICTION_HEADERS,
    `Pathogens with AI-predicted activity ${DISCOVERY_THRESHOLD_TEXT}`,
    "Laboratory records (ChEMBL)",
    "Registered clinical studies (ClinicalTrials.gov)",
    "Evidence",
    "Repurposing candidate",
  ];
  const rows = records.map((r) => [
    r.name,
    r.brandNames.join("; "),
    r.moleculeId,
    r.chemblId,
    r.applications.join("; "),
    r.firstApproval,
    existingUseText(r.use, 50) ?? "Not recorded in the sources checked",
    r.use?.atcGroups.join("; ") ?? "",
    r.use?.fdaClasses.join("; ") ?? "",
    r.use?.status ? STATUS_TEXT[r.use.status] : "Not yet checked",
    antibacterialFlag(r),
    r.use?.basis ?? "",
    r.hasStructure,
    ...PATHOGEN_KEYS.map((k) => pct(r.predictions[k])),
    qualifying(r).map((k) => PATHOGEN_COLUMN[k]).join("; "),
    r.labRecords,
    r.registryChecked ? r.studies : "not yet checked",
    evidenceText(r),
    r.isCandidate,
  ]);
  return { csv: toCsv(header, rows), rows: rows.length };
}

export async function repurposingCandidatesCsv(
  pathogenKey?: PathogenKey,
): Promise<{ csv: string; rows: number }> {
  const records = (await getLibraryRecords()).filter(
    (r) => r.isCandidate && (!pathogenKey || qualifying(r).includes(pathogenKey)),
  );
  const header = [
    "Medicine",
    "InChIKey",
    "ChEMBL ID",
    "Existing / approved use",
    "Anti-infective classification",
    "Existing antibacterial (true / false / unclassified)",
    ...PREDICTION_HEADERS,
    `Pathogens with AI-predicted activity ${DISCOVERY_THRESHOLD_TEXT}`,
    "Laboratory records (ChEMBL)",
    "Registered clinical studies (ClinicalTrials.gov)",
    "Evidence",
  ];
  const rows = records.map((r) => [
    r.name,
    r.moleculeId,
    r.chemblId,
    existingUseText(r.use, 50) ?? "Not recorded in the sources checked",
    r.use?.status ? STATUS_TEXT[r.use.status] : "Not yet checked",
    antibacterialFlag(r),
    ...PATHOGEN_KEYS.map((k) => pct(r.predictions[k])),
    qualifying(r).map((k) => PATHOGEN_COLUMN[k]).join("; "),
    r.labRecords,
    r.registryChecked ? r.studies : "not yet checked",
    evidenceText(r),
  ]);
  return { csv: toCsv(header, rows), rows: rows.length };
}

/** The three-valued flag. A medicine never looked up reads "not yet checked". */
function antibacterialFlag(r: LibraryRecord): string {
  if (!r.use?.status) return "not yet checked";
  if (r.use.status === "antibacterial") return "true";
  if (r.use.status === "unclassified") return "unclassified";
  return "false";
}
