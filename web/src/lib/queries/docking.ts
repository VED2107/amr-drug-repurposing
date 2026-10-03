import "server-only";

import { queryLive, toNum } from "@/lib/db/client";

/**
 * The batch docking campaign, read live from the `docking` schema.
 *
 * Definitions match `src/batchdock/progress.py` exactly:
 *
 * - scope: every library medicine x every selected target, under the
 *   configuration of the current full run, whichever run executed the job;
 * - "completed" means AutoDock Vina ran and a checked result is stored;
 * - docking failures, unavailable structures, failed ligand preparation and
 *   failed target preparation are separate categories, and the success rate is
 *   completed / (completed + docking failures) — an input that never existed
 *   is not a docking failure;
 * - throughput is measured over the last 15 minutes and the ETA is withheld
 *   until at least ten jobs completed in that window.
 *
 * Every function returns `null` when the docking queue is not reachable (the
 * SQLite development source has none), never a zero that would read as "none".
 */

export const MIN_COMPLETIONS_FOR_ETA = 10;

export interface DockingTargetSummary {
  targetId: string;
  pathogenKey: string;
  organism: string;
  proteinName: string;
  pdbId: string | null;
  status: string;
  completed: number;
  total: number;
}

export interface DockingStatus {
  runId: string | null;
  runName: string | null;
  runStatus: string | null;
  engine: string | null;
  engineVersion: string | null;
  startedAt: string | null;
  configHash: string;
  configuration: {
    versionLabel: string;
    exhaustiveness: number;
    numModes: number;
    energyRange: number;
    seed: number;
    boxSize: [number, number, number];
  } | null;
  validation: { runId: string; passed: boolean | null } | null;
  medicines: { total: number; processed: number; remaining: number };
  ligands: { ready: number; structureUnavailable: number; preparationFailed: number; pending: number };
  targets: DockingTargetSummary[];
  jobs: {
    expected: number;
    total: number;
    notYetCreated: number;
    queued: number;
    running: number;
    completed: number;
    dockingFailed: number;
    structureUnavailable: number;
    ligandPreparationFailed: number;
    targetPreparationFailed: number;
    cancelled: number;
    remaining: number;
    finished: number;
  };
  percentFinished: number;
  percentCompleted: number;
  throughput: { jobsPerMinute5m: number; jobsPerMinute15m: number };
  etaMinutes: number | null;
  estimatedCompletionAt: string | null;
  averageDockingSeconds: number | null;
  successRate: number | null;
  firstStartedAt: string | null;
  lastCompletedAt: string | null;
  workers: { online: number; slots: number };
  readAt: string;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => toNum(v) ?? 0;
const str = (v: unknown) => (v == null ? null : String(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

/** The configuration of the most recent full run, or of any run if no full run exists yet. */
async function currentConfig(): Promise<string | null> {
  const rows = await queryLive<Row>(
    `select config_hash from docking.runs
      order by case when kind = 'full' and status <> 'CANCELLED' then 0 else 1 end, created_at desc
      limit 1`,
  );
  if (!rows) return null;
  return rows.length ? String(rows[0].config_hash) : null;
}

export async function getDockingStatus(): Promise<DockingStatus | null> {
  let configHash: string | null;
  try {
    configHash = await currentConfig();
  } catch {
    return null; // schema not migrated on this database
  }
  if (!configHash) return null;

  const [runRows, cfgRows, valRows, medRows, ligRows, tgtRows, jobRows, procRows, wkRows] = await Promise.all([
    queryLive<Row>(
      `select run_id, run_name, status, engine, engine_version, started_at from docking.runs
        where kind = 'full' and config_hash = ? and status <> 'CANCELLED' order by created_at desc limit 1`,
      [configHash],
    ),
    queryLive<Row>(
      `select version_label, exhaustiveness, num_modes, energy_range, seed, box_size_x, box_size_y, box_size_z
         from docking.configurations where config_hash = ?`,
      [configHash],
    ),
    queryLive<Row>(
      `select run_id, validation_passed from docking.runs where kind = 'validation' and config_hash = ?
        order by created_at desc limit 1`,
      [configHash],
    ),
    queryLive<Row>(`select count(distinct molecule_id) as n from amr.drugs where molecule_id is not null`),
    queryLive<Row>(
      `select count(*) filter (where preparation_status = 'READY') as ready,
              count(*) filter (where preparation_status = 'STRUCTURE_UNAVAILABLE') as unavailable,
              count(*) filter (where preparation_status = 'LIGAND_PREPARATION_FAILED') as failed,
              count(*) filter (where preparation_status = 'PENDING') as pending
         from docking.ligands where molecule_id is not null`,
    ),
    queryLive<Row>(
      `select t.target_id, t.pathogen_key, t.organism, t.protein_name, t.pdb_id, t.preparation_status,
              count(j.id) filter (where j.status = 'COMPLETED') as completed,
              count(j.id) as total
         from docking.targets t
         left join docking.jobs j on j.target_id = t.target_id and j.config_hash = ?
              and j.ligand_id in (select ligand_id from docking.ligands where molecule_id is not null)
        where t.selected
        group by t.target_id, t.pathogen_key, t.organism, t.protein_name, t.pdb_id, t.preparation_status
        order by t.target_id`,
      [configHash],
    ),
    queryLive<Row>(
      `select count(*) as total,
              count(*) filter (where j.status = 'QUEUED') as queued,
              count(*) filter (where j.status = 'RUNNING') as running,
              count(*) filter (where j.status = 'COMPLETED') as completed,
              count(*) filter (where j.status in ('DOCKING_FAILED','FAILED')) as docking_failed,
              count(*) filter (where j.status = 'STRUCTURE_UNAVAILABLE') as unavailable,
              count(*) filter (where j.status = 'LIGAND_PREPARATION_FAILED') as lig_failed,
              count(*) filter (where j.status = 'TARGET_PREPARATION_FAILED') as tgt_failed,
              count(*) filter (where j.status = 'CANCELLED') as cancelled,
              count(*) filter (where j.status = 'COMPLETED' and j.completed_at > now() - interval '5 minutes') as done5,
              count(*) filter (where j.status = 'COMPLETED' and j.completed_at > now() - interval '15 minutes') as done15,
              avg(j.duration_seconds) filter (where j.status = 'COMPLETED') as avg_dur,
              min(j.started_at) as first_start,
              max(j.completed_at) filter (where j.status = 'COMPLETED') as last_done
         from docking.jobs j
         join docking.ligands l on l.ligand_id = j.ligand_id
         join docking.targets t on t.target_id = j.target_id and t.selected
        where j.config_hash = ? and l.molecule_id is not null`,
      [configHash],
    ),
    queryLive<Row>(
      `select count(*) as n from (
          select j.ligand_id from docking.jobs j join docking.ligands l on l.ligand_id = j.ligand_id
           where j.config_hash = ? and l.molecule_id is not null
           group by j.ligand_id
          having count(*) filter (where j.status in ('QUEUED','RUNNING')) = 0) x`,
      [configHash],
    ),
    queryLive<Row>(
      `select count(*) as n, coalesce(sum(concurrency), 0) as slots from docking.workers
        where status in ('RUNNING','STOPPING') and last_seen_at > now() - interval '3 minutes'`,
    ),
  ]);

  const run = runRows?.[0];
  const cfg = cfgRows?.[0];
  const j = jobRows?.[0] ?? {};
  const medicines = num(medRows?.[0]?.n);
  const targets: DockingTargetSummary[] = (tgtRows ?? []).map((t) => ({
    targetId: String(t.target_id),
    pathogenKey: String(t.pathogen_key),
    organism: String(t.organism),
    proteinName: String(t.protein_name),
    pdbId: str(t.pdb_id),
    status: String(t.preparation_status),
    completed: num(t.completed),
    total: num(t.total),
  }));

  const total = num(j.total);
  const queued = num(j.queued);
  const running = num(j.running);
  const completed = num(j.completed);
  const dockingFailed = num(j.docking_failed);
  const expected = medicines * targets.length;
  const remaining = queued + running;
  const finished = total - remaining;
  const done15 = num(j.done15);
  const rate15 = done15 / 15;
  const etaMinutes = done15 >= MIN_COMPLETIONS_FOR_ETA && rate15 > 0 ? remaining / rate15 : null;
  const attempted = completed + dockingFailed;
  const processed = num(procRows?.[0]?.n);
  const pct = (v: number) => (expected ? Math.round((10000 * v) / expected) / 100 : 0);
  const now = new Date();

  return {
    runId: str(run?.run_id),
    runName: str(run?.run_name),
    runStatus: str(run?.status),
    engine: str(run?.engine),
    engineVersion: str(run?.engine_version),
    startedAt: iso(run?.started_at),
    configHash,
    configuration: cfg
      ? {
          versionLabel: String(cfg.version_label),
          exhaustiveness: num(cfg.exhaustiveness),
          numModes: num(cfg.num_modes),
          energyRange: num(cfg.energy_range),
          seed: num(cfg.seed),
          boxSize: [num(cfg.box_size_x), num(cfg.box_size_y), num(cfg.box_size_z)],
        }
      : null,
    validation: valRows?.[0]
      ? {
          runId: String(valRows[0].run_id),
          passed: valRows[0].validation_passed == null ? null : Boolean(valRows[0].validation_passed),
        }
      : null,
    medicines: { total: medicines, processed, remaining: medicines - processed },
    ligands: {
      ready: num(ligRows?.[0]?.ready),
      structureUnavailable: num(ligRows?.[0]?.unavailable),
      preparationFailed: num(ligRows?.[0]?.failed),
      pending: num(ligRows?.[0]?.pending),
    },
    targets,
    jobs: {
      expected,
      total,
      notYetCreated: Math.max(0, expected - total),
      queued,
      running,
      completed,
      dockingFailed,
      structureUnavailable: num(j.unavailable),
      ligandPreparationFailed: num(j.lig_failed),
      targetPreparationFailed: num(j.tgt_failed),
      cancelled: num(j.cancelled),
      remaining,
      finished,
    },
    percentFinished: pct(finished),
    percentCompleted: pct(completed),
    throughput: {
      jobsPerMinute5m: Math.round((num(j.done5) / 5) * 100) / 100,
      jobsPerMinute15m: Math.round(rate15 * 100) / 100,
    },
    etaMinutes: etaMinutes == null ? null : Math.round(etaMinutes * 10) / 10,
    estimatedCompletionAt:
      etaMinutes == null ? null : new Date(now.getTime() + etaMinutes * 60_000).toISOString(),
    averageDockingSeconds: j.avg_dur == null ? null : Math.round(num(j.avg_dur) * 10) / 10,
    successRate: attempted ? Math.round((10000 * completed) / attempted) / 10000 : null,
    firstStartedAt: iso(j.first_start),
    lastCompletedAt: iso(j.last_done),
    workers: { online: num(wkRows?.[0]?.n), slots: num(wkRows?.[0]?.slots) },
    readAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "DOCKING_FAILED",
  "FAILED",
  "STRUCTURE_UNAVAILABLE",
  "LIGAND_PREPARATION_FAILED",
  "TARGET_PREPARATION_FAILED",
  "CANCELLED",
] as const;

export interface DockingFilters {
  drug?: string;
  target?: string;
  organism?: string;
  status?: string;
  outcome?: "completed" | "failed" | "";
  minAffinity?: number | null;
  maxAffinity?: number | null;
  run?: string;
  sort?: "affinity" | "recent";
  page?: number;
  pageSize?: number;
}

export interface DockingRow {
  jobId: number;
  ligandId: string;
  drug: string;
  targetId: string;
  proteinName: string;
  pathogenKey: string;
  pdbId: string | null;
  status: string;
  bestAffinity: number | null;
  posesCount: number | null;
  engine: string | null;
  engineVersion: string | null;
  runId: string;
  completedAt: string | null;
  error: string | null;
}

export async function listDockingResults(
  f: DockingFilters,
): Promise<{ rows: DockingRow[]; total: number; page: number; pageSize: number } | null> {
  const configHash = await currentConfig().catch(() => null);
  if (!configHash) return null;
  const where: string[] = ["j.config_hash = ?", "l.molecule_id is not null"];
  const params: (string | number)[] = [configHash];
  if (f.drug) {
    where.push("(l.name ilike ? or l.ligand_id = ?)");
    params.push(`%${f.drug}%`, f.drug);
  }
  if (f.target) {
    where.push("j.target_id = ?");
    params.push(f.target);
  }
  if (f.organism) {
    where.push("t.pathogen_key = ?");
    params.push(f.organism);
  }
  if (f.status && (JOB_STATUSES as readonly string[]).includes(f.status)) {
    where.push("j.status = ?");
    params.push(f.status);
  }
  if (f.outcome === "completed") where.push("j.status = 'COMPLETED'");
  if (f.outcome === "failed") where.push("j.status not in ('COMPLETED','QUEUED','RUNNING')");
  if (f.minAffinity != null) {
    where.push("r.best_affinity >= ?");
    params.push(f.minAffinity);
  }
  if (f.maxAffinity != null) {
    where.push("r.best_affinity <= ?");
    params.push(f.maxAffinity);
  }
  if (f.run) {
    where.push("j.run_id = ?");
    params.push(f.run);
  }
  const pageSize = Math.min(200, Math.max(10, f.pageSize ?? 50));
  const page = Math.max(1, f.page ?? 1);
  const order =
    f.sort === "recent"
      ? "j.completed_at desc nulls last, j.id"
      : "r.best_affinity asc nulls last, j.completed_at desc nulls last, j.id";
  const from = `from docking.jobs j
      join docking.ligands l on l.ligand_id = j.ligand_id
      join docking.targets t on t.target_id = j.target_id
      left join docking.results r on r.job_id = j.id
     where ${where.join(" and ")}`;
  const [rows, count] = await Promise.all([
    queryLive<Row>(
      `select j.id, j.ligand_id, coalesce(l.name, j.ligand_id) as drug, j.target_id, t.protein_name,
              t.pathogen_key, t.pdb_id, j.status, r.best_affinity, r.poses_count, r.engine,
              r.engine_version, j.run_id, j.completed_at, j.error_message
         ${from} order by ${order} limit ? offset ?`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    queryLive<Row>(`select count(*) as n ${from}`, params),
  ]);
  if (!rows || !count) return null;
  return {
    rows: rows.map((r) => ({
      jobId: num(r.id),
      ligandId: String(r.ligand_id),
      drug: String(r.drug),
      targetId: String(r.target_id),
      proteinName: String(r.protein_name),
      pathogenKey: String(r.pathogen_key),
      pdbId: str(r.pdb_id),
      status: String(r.status),
      bestAffinity: toNum(r.best_affinity),
      posesCount: toNum(r.poses_count),
      engine: str(r.engine),
      engineVersion: str(r.engine_version),
      runId: String(r.run_id),
      completedAt: iso(r.completed_at),
      error: str(r.error_message),
    })),
    total: num(count[0]?.n),
    page,
    pageSize,
  };
}

export interface DockingPose {
  rank: number;
  affinity: number;
  rmsd_lb: number;
  rmsd_ub: number;
}

export interface DockingJobDetail extends DockingRow {
  organism: string;
  gene: string | null;
  uniprotId: string | null;
  chain: string | null;
  bindingSite: string | null;
  targetStructureSource: string | null;
  receptorMethod: string | null;
  ligandStructureSource: string | null;
  ligandMethod: string | null;
  canonicalSmiles: string | null;
  configHash: string;
  attemptCount: number;
  startedAt: string | null;
  durationSeconds: number | null;
  result: {
    poses: DockingPose[];
    rmsdLowerBound: number | null;
    rmsdUpperBound: number | null;
    exhaustiveness: number;
    numModes: number;
    energyRange: number;
    seed: number;
    cpu: number;
    center: [number, number, number];
    size: [number, number, number];
    receptorSha256: string;
    ligandSha256: string;
    command: string;
    workerId: string;
    createdAt: string | null;
    poseArtifact: { id: number; sha256: string; sizeBytes: number; key: string } | null;
    logArtifact: { id: number; sha256: string; sizeBytes: number; key: string } | null;
  } | null;
}

export async function getDockingJob(jobId: number): Promise<DockingJobDetail | null> {
  const rows = await queryLive<Row>(
    `select j.id, j.ligand_id, coalesce(l.name, j.ligand_id) as drug, j.target_id, t.protein_name,
            t.pathogen_key, t.pdb_id, j.status, j.run_id, j.completed_at, j.error_message, j.config_hash,
            j.attempt_count, j.started_at, j.duration_seconds,
            t.organism, t.gene, t.uniprot_id, t.chain, t.binding_site_definition, t.structure_source,
            t.preparation_method as receptor_method, l.structure_source as ligand_source,
            l.preparation_method as ligand_method, l.canonical_smiles,
            r.best_affinity, r.poses_count, r.poses, r.rmsd_lower_bound, r.rmsd_upper_bound, r.engine,
            r.engine_version, r.exhaustiveness, r.num_modes, r.energy_range, r.seed, r.cpu,
            r.center_x, r.center_y, r.center_z, r.size_x, r.size_y, r.size_z, r.receptor_sha256,
            r.ligand_sha256, r.command, r.worker_id, r.created_at,
            pa.id as pose_id, pa.sha256 as pose_sha, pa.size_bytes as pose_size, pa.object_key as pose_key,
            la.id as log_id, la.sha256 as log_sha, la.size_bytes as log_size, la.object_key as log_key
       from docking.jobs j
       join docking.ligands l on l.ligand_id = j.ligand_id
       join docking.targets t on t.target_id = j.target_id
       left join docking.results r on r.job_id = j.id
       left join docking.artifacts pa on pa.id = r.pose_artifact_id
       left join docking.artifacts la on la.id = r.log_artifact_id
      where j.id = ?`,
    [jobId],
  ).catch(() => null);
  const r = rows?.[0];
  if (!r) return null;
  const poses = (typeof r.poses === "string" ? JSON.parse(r.poses) : r.poses) as DockingPose[] | null;
  return {
    jobId: num(r.id),
    ligandId: String(r.ligand_id),
    drug: String(r.drug),
    targetId: String(r.target_id),
    proteinName: String(r.protein_name),
    pathogenKey: String(r.pathogen_key),
    pdbId: str(r.pdb_id),
    status: String(r.status),
    bestAffinity: toNum(r.best_affinity),
    posesCount: toNum(r.poses_count),
    engine: str(r.engine),
    engineVersion: str(r.engine_version),
    runId: String(r.run_id),
    completedAt: iso(r.completed_at),
    error: str(r.error_message),
    organism: String(r.organism),
    gene: str(r.gene),
    uniprotId: str(r.uniprot_id),
    chain: str(r.chain),
    bindingSite: str(r.binding_site_definition),
    targetStructureSource: str(r.structure_source),
    receptorMethod: str(r.receptor_method),
    ligandStructureSource: str(r.ligand_source),
    ligandMethod: str(r.ligand_method),
    canonicalSmiles: str(r.canonical_smiles),
    configHash: String(r.config_hash),
    attemptCount: num(r.attempt_count),
    startedAt: iso(r.started_at),
    durationSeconds: toNum(r.duration_seconds),
    result:
      r.best_affinity == null || !poses
        ? null
        : {
            poses,
            rmsdLowerBound: toNum(r.rmsd_lower_bound),
            rmsdUpperBound: toNum(r.rmsd_upper_bound),
            exhaustiveness: num(r.exhaustiveness),
            numModes: num(r.num_modes),
            energyRange: num(r.energy_range),
            seed: num(r.seed),
            cpu: num(r.cpu),
            center: [num(r.center_x), num(r.center_y), num(r.center_z)],
            size: [num(r.size_x), num(r.size_y), num(r.size_z)],
            receptorSha256: String(r.receptor_sha256),
            ligandSha256: String(r.ligand_sha256),
            command: String(r.command),
            workerId: String(r.worker_id),
            createdAt: iso(r.created_at),
            poseArtifact:
              r.pose_id == null
                ? null
                : { id: num(r.pose_id), sha256: String(r.pose_sha), sizeBytes: num(r.pose_size), key: String(r.pose_key) },
            logArtifact:
              r.log_id == null
                ? null
                : { id: num(r.log_id), sha256: String(r.log_sha), sizeBytes: num(r.log_size), key: String(r.log_key) },
          },
  };
}

/** Campaign results for one medicine, one row per selected target (docked or not). */
export interface MedicineDocking {
  targetId: string;
  pathogenKey: string;
  proteinName: string;
  pdbId: string | null;
  jobId: number | null;
  status: string | null;
  bestAffinity: number | null;
}

export async function getMedicineDocking(moleculeId: string): Promise<MedicineDocking[] | null> {
  const configHash = await currentConfig().catch(() => null);
  if (!configHash) return null;
  const rows = await queryLive<Row>(
    `select t.target_id, t.pathogen_key, t.protein_name, t.pdb_id, j.id as job_id, j.status, r.best_affinity
       from docking.targets t
       left join docking.ligands l on l.molecule_id = ?
       left join docking.jobs j on j.target_id = t.target_id and j.ligand_id = l.ligand_id and j.config_hash = ?
       left join docking.results r on r.job_id = j.id
      where t.selected
      order by t.target_id`,
    [moleculeId, configHash],
  ).catch(() => null);
  if (!rows) return null;
  return rows.map((r) => ({
    targetId: String(r.target_id),
    pathogenKey: String(r.pathogen_key),
    proteinName: String(r.protein_name),
    pdbId: str(r.pdb_id),
    jobId: r.job_id == null ? null : num(r.job_id),
    status: str(r.status),
    bestAffinity: toNum(r.best_affinity),
  }));
}

/* ------------------------------------------------------------------ */
/* Operator actions                                                    */
/* ------------------------------------------------------------------ */

/** Requeue docking failures (not input failures) of the current configuration. */
export async function retryFailedJobs(jobId?: number): Promise<number | null> {
  const configHash = await currentConfig();
  if (!configHash) return null;
  const rows = await queryLive<Row>(
    `with r as (
        update docking.jobs set status = 'QUEUED', not_before = null, completed_at = null,
               max_attempts = attempt_count + 1, worker_id = null, updated_at = now()
         where config_hash = ? and status in ('FAILED','DOCKING_FAILED')
           and (?::bigint is null or id = ?::bigint)
        returning id)
     select count(*) as n from r`,
    [configHash, jobId ?? null, jobId ?? null],
  );
  await queryLive(
    `update docking.runs set status = 'RUNNING', completed_at = null
      where kind = 'full' and config_hash = ? and status in ('PAUSED','COMPLETED')`,
    [configHash],
  );
  return rows ? num(rows[0]?.n) : null;
}

/** Return stale RUNNING jobs to the queue and unpause the full run. Completed jobs are untouched. */
export async function resumeRun(): Promise<{ requeued: number } | null> {
  const configHash = await currentConfig();
  if (!configHash) return null;
  const rows = await queryLive<Row>(
    `with r as (
        update docking.jobs set status = 'QUEUED', worker_id = null, lease_expires_at = null,
               error_message = 'lease expired: worker stopped heartbeating; requeued', updated_at = now()
         where status = 'RUNNING' and lease_expires_at < now() and attempt_count < max_attempts
        returning id)
     select count(*) as n from r`,
  );
  await queryLive(
    `update docking.runs set status = 'RUNNING', completed_at = null
      where kind = 'full' and config_hash = ? and status = 'PAUSED'`,
    [configHash],
  );
  return rows ? { requeued: num(rows[0]?.n) } : null;
}
