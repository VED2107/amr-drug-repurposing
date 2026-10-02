import "server-only";

/**
 * Figures from the project presentation that the overview quotes, read live
 * rather than copied from the slides, so a page never shows a number the
 * database no longer supports.
 */

import { query, queryOne, toNum } from "@/lib/db/client";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";

const ACTIVE = "join model_versions m on m.model_version = p.model_version and m.status = 'ACTIVE'";
const LIBRARY = "(select distinct molecule_id from drugs where molecule_id is not null)";

export interface DockingTarget {
  pathogenKey: PathogenKey;
  name: string;
  pdbId: string | null;
}

export interface StoryFigures {
  /**
   * Valid molecular structures: the broader molecular dataset the research
   * pipeline works from. A different population from the approved-medicine
   * library, never added to it.
   */
  validMolecules: number;
  /** Laboratory activity records carrying an active/inactive label. */
  labelledLabRecords: number;
  /** Current-model predictions for library medicines (medicines × pathogens). */
  libraryPredictions: number;
  /** Library medicines with at least one successful docking result. */
  dockedMedicines: number;
  /** Library medicines queried at ClinicalTrials.gov. */
  registryChecked: number;
  /** The prepared docking target for each pathogen, as the docking stage used it. */
  targets: DockingTarget[];
}

export async function getStoryFigures(): Promise<StoryFigures> {
  const [row, targets] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `select
         (select count(*) from molecules where is_valid)                       as n,
         (select count(*) from bioactivity where label is not null)            as labelled,
         (select count(*) from predictions p ${ACTIVE}
           where p.molecule_id in ${LIBRARY})                                   as predictions,
         (select count(distinct molecule_id) from docking_results
           where status = 'ok' and score_kcal_mol is not null
             and molecule_id in ${LIBRARY})                                     as docked,
         (select count(distinct molecule_id) from clinical_queries
           where molecule_id in ${LIBRARY})                                     as checked`,
    ),
    query<Record<string, unknown>>(`select pathogen_key, name, pdb_id from targets`),
  ]);
  return {
    validMolecules: toNum(row?.n) ?? 0,
    labelledLabRecords: toNum(row?.labelled) ?? 0,
    libraryPredictions: toNum(row?.predictions) ?? 0,
    dockedMedicines: toNum(row?.docked) ?? 0,
    registryChecked: toNum(row?.checked) ?? 0,
    targets: PATHOGEN_KEYS.flatMap((key) => {
      const t = targets.find((x) => String(x.pathogen_key) === key);
      return t
        ? [{ pathogenKey: key, name: String(t.name), pdbId: t.pdb_id == null ? null : String(t.pdb_id) }]
        : [];
    }),
  };
}

/* ------------------------------------------------------------------ */
/* What the models learned from                                        */
/* ------------------------------------------------------------------ */

export interface TrainingFigures {
  perPathogen: {
    key: PathogenKey;
    label: string;
    actives: number;
    inactives: number;
    /** Labelled records measured against a named resistant strain. */
    resistant: number;
  }[];
  /** Records between the two potency thresholds, left out of training. */
  ambiguous: number;
}

export async function getTrainingFigures(): Promise<TrainingFigures> {
  const [rows, amb] = await Promise.all([
    query<Record<string, unknown>>(
      `select b.pathogen_key, p.label,
              sum(case when b.label = 1 then 1 else 0 end) as actives,
              sum(case when b.label = 0 then 1 else 0 end) as inactives,
              sum(case when b.strain_specific then 1 else 0 end) as resistant
         from bioactivity b join pathogens p on p.key = b.pathogen_key
        where b.label is not null
        group by b.pathogen_key, p.label`,
    ),
    queryOne<Record<string, unknown>>(`select count(*) as n from bioactivity where label is null`),
  ]);
  return {
    perPathogen: PATHOGEN_KEYS.flatMap((key) => {
      const r = rows.find((x) => String(x.pathogen_key) === key);
      return r
        ? [
            {
              key,
              label: String(r.label),
              actives: toNum(r.actives) ?? 0,
              inactives: toNum(r.inactives) ?? 0,
              resistant: toNum(r.resistant) ?? 0,
            },
          ]
        : [];
    }),
    ambiguous: toNum(amb?.n) ?? 0,
  };
}
