import "server-only";

import { num } from "@/components/primitives";
import { queryOne, toNum } from "@/lib/db/client";
import type { ReadoutKey } from "@/lib/nav";
import { getMolecularOverview } from "./analysis";
import { getCoverageSummary } from "./core";

export interface Readout {
  /** What the index prints: short, set in mono. */
  text: string;
  /** What a screen reader hears after the section name. */
  spoken: string;
  /**
   * A coverage gauge: how much of its universe this section has covered. Only
   * given where the fraction means something — a numerator and a denominator
   * that are the same kind of thing — and always printed as text beside it.
   */
  gauge?: { done: number; of: number; tone: "clinical" | "computational" | "ink" | "none" };
}

export type Readouts = Partial<Record<ReadoutKey, Readout>>;

/**
 * The live figures the research index prints beside its sections.
 *
 * Read down the index and the gauges show where the evidence runs out: every
 * approved medicine has been queried against the registry and scored by the
 * models, and only a sliver has been docked. That is the research gap, and the
 * navigation is where a reader first meets it.
 *
 * Every figure comes from the same query as the page it leads to, so the index
 * cannot disagree with its destination. If the database cannot be reached the
 * index prints no figures at all — never a zero, which would be a claim that
 * there is nothing there.
 */
export async function getNavReadouts(snapshot: string | null): Promise<Readouts> {
  const readouts: Readouts = {
    future: {
      text: "not built",
      spoken: "future work, not built",
      gauge: { done: 0, of: 1, tone: "none" },
    },
  };
  if (snapshot) readouts.lastRun = { text: snapshot, spoken: `last pipeline run ${snapshot}` };

  try {
    const [c, molecular, scoredRow] = await Promise.all([
      getCoverageSummary(),
      getMolecularOverview(),
      queryOne<Record<string, unknown>>(`
        select count(distinct p.molecule_id) as n
          from predictions p
          join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'
         where p.molecule_id in (select molecule_id from drugs where molecule_id is not null)
      `),
    ]);
    const library = c.approvedMedicines;
    const scored = toNum(scoredRow?.n);

    readouts.medicines = {
      text: num(library),
      spoken: `${num(library)} approved medicines`,
    };
    if (scored !== null) {
      readouts.predictions = {
        text: `${num(scored)}/${num(library)}`,
        spoken: `${num(scored)} of ${num(library)} approved medicines scored by the ACTIVE models`,
        gauge: { done: scored, of: library, tone: "computational" },
      };
    }
    readouts.models = {
      text: `${c.activeModels} ACTIVE`,
      spoken: `${c.activeModels} ACTIVE models`,
    };
    readouts.structures = {
      text: `${num(molecular.valid)}/${num(molecular.molecules)}`,
      spoken: `${num(molecular.valid)} of ${num(molecular.molecules)} ingested molecules have a valid structure`,
      gauge: { done: molecular.valid, of: molecular.molecules, tone: "ink" },
    };
    readouts.docked = {
      text: `${num(c.dockedMedicines)}/${num(library)}`,
      spoken: `${num(c.dockedMedicines)} of ${num(library)} medicines docked; the rest are not yet docked`,
      gauge: { done: c.dockedMedicines, of: library, tone: "computational" },
    };
    readouts.clinical = {
      text: `${num(c.clinicalChecked)}/${num(c.clinicalTotal)}`,
      spoken: `${num(c.clinicalChecked)} of ${num(c.clinicalTotal)} medicines queried against the registry`,
      gauge: { done: c.clinicalChecked, of: c.clinicalTotal, tone: "clinical" },
    };
  } catch {
    // Unreachable database: the index still renders, without figures.
  }
  return readouts;
}
