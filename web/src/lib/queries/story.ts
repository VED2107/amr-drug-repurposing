import "server-only";

/**
 * Figures from the project presentation that the overview quotes, read live
 * rather than copied from the slides, so a page never shows a number the
 * database no longer supports.
 */

import { query, queryLive, queryOne, toNum } from "@/lib/db/client";
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
  /**
   * The batch docking campaign (medicines x targets), read live. Null when the
   * docking queue is not on this database.
   */
  docking: { jobsExpected: number; jobsCompleted: number; jobsFinished: number; medicines: number; targets: number } | null;
  /** Library medicines queried at ClinicalTrials.gov. */
  registryChecked: number;
  /** The prepared docking target for each pathogen, as the docking stage used it. */
  targets: DockingTarget[];
}

export async function getStoryFigures(): Promise<StoryFigures> {
  const [row, targets, docking] = await Promise.all([
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
    getDockingFigures(),
  ]);
  return {
    validMolecules: toNum(row?.n) ?? 0,
    labelledLabRecords: toNum(row?.labelled) ?? 0,
    libraryPredictions: toNum(row?.predictions) ?? 0,
    dockedMedicines: docking?.medicines ?? toNum(row?.docked) ?? 0,
    docking: docking
      ? {
          jobsExpected: docking.expected,
          jobsCompleted: docking.completed,
          jobsFinished: docking.finished,
          medicines: docking.medicines,
          targets: docking.targets,
        }
      : null,
    registryChecked: toNum(row?.checked) ?? 0,
    targets: PATHOGEN_KEYS.flatMap((key) => {
      const t = targets.find((x) => String(x.pathogen_key) === key);
      return t
        ? [{ pathogenKey: key, name: String(t.name), pdbId: t.pdb_id == null ? null : String(t.pdb_id) }]
        : [];
    }),
  };
}

/**
 * Campaign counts for the overview, from the docking queue (live, uncached).
 * "medicines" counts library medicines with at least one completed docking.
 */
async function getDockingFigures(): Promise<
  { expected: number; completed: number; finished: number; medicines: number; targets: number } | null
> {
  try {
    const rows = await queryLive<Record<string, unknown>>(
      `with cfg as (
          select config_hash from docking.runs where kind = 'full' and status <> 'CANCELLED'
           order by created_at desc limit 1),
        lib as (select count(distinct molecule_id) as n from amr.drugs where molecule_id is not null),
        tgt as (select count(*) as n from docking.targets where selected)
       select lib.n * tgt.n as expected, tgt.n as targets,
              count(j.id) filter (where j.status = 'COMPLETED') as completed,
              count(j.id) filter (where j.status not in ('QUEUED','RUNNING')) as finished,
              count(distinct j.ligand_id) filter (where j.status = 'COMPLETED') as medicines
         from cfg cross join lib cross join tgt
         left join docking.jobs j on j.config_hash = cfg.config_hash
              and j.ligand_id in (select ligand_id from docking.ligands where molecule_id is not null)
              and j.target_id in (select target_id from docking.targets where selected)
        group by lib.n, tgt.n`,
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      expected: toNum(r.expected) ?? 0,
      completed: toNum(r.completed) ?? 0,
      finished: toNum(r.finished) ?? 0,
      medicines: toNum(r.medicines) ?? 0,
      targets: toNum(r.targets) ?? 0,
    };
  } catch {
    return null;
  }
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
