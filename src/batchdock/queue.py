"""The job queue, in Postgres.

The database is the only source of truth. A job moves:

    QUEUED -> RUNNING -> COMPLETED
                      -> DOCKING_FAILED / FAILED          (terminal)
                      -> QUEUED (retry, with backoff)     (transient error)
                      -> QUEUED (lease expired: worker vanished)

and is created directly in a terminal state when its input can never exist
(STRUCTURE_UNAVAILABLE, LIGAND_PREPARATION_FAILED, TARGET_PREPARATION_FAILED).

Claiming is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
LOCKED)`, so any number of workers on any number of machines can pull from the
same queue without ever receiving the same job. Completion is conditional on
the worker still holding the lease, and the result row is unique per job and
per (ligand, target, configuration), so a job whose lease was taken over can
never produce a second result.
"""

from __future__ import annotations

import json
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from importlib import resources
from typing import Any, Iterator

import psycopg
from psycopg.types.json import Jsonb

from ..logging_utils import get_logger
from .config import DockingParameters

log = get_logger("amr.batchdock.queue")

TERMINAL = ("COMPLETED", "FAILED", "STRUCTURE_UNAVAILABLE", "LIGAND_PREPARATION_FAILED",
            "TARGET_PREPARATION_FAILED", "DOCKING_FAILED", "CANCELLED")
#: Failures of the docking step itself — the only ones `retry-failed` requeues.
RETRYABLE_FAILURES = ("FAILED", "DOCKING_FAILED")
#: Failures that say the input does not exist or cannot be made.
INPUT_FAILURES = ("STRUCTURE_UNAVAILABLE", "LIGAND_PREPARATION_FAILED", "TARGET_PREPARATION_FAILED")


def connect(url: str) -> psycopg.Connection:
    """Autocommit connection. `prepare_threshold=None` because Supabase's
    transaction pooler cannot keep server-side prepared statements."""
    return psycopg.connect(url, autocommit=True, prepare_threshold=None,
                           connect_timeout=20, application_name="amr-batchdock")


@contextmanager
def transaction(conn: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with conn.transaction():
        yield conn


def schema_sql() -> str:
    return resources.files("src.batchdock").joinpath("schema.sql").read_text(encoding="utf-8")


def migrate(conn: psycopg.Connection) -> None:
    with transaction(conn):
        conn.execute(schema_sql())


def backoff_seconds(attempt: int, base: int = 30, cap: int = 900) -> int:
    """Exponential backoff for transient failures: 30 s, 60 s, 120 s ... capped."""
    return int(min(cap, base * (2 ** max(0, attempt - 1))))


# ---------------------------------------------------------------------------
# Configuration and runs
# ---------------------------------------------------------------------------

def register_configuration(conn, params: DockingParameters) -> str:
    conn.execute(
        """insert into docking.configurations(config_hash, version_label, engine, engine_version,
               exhaustiveness, num_modes, energy_range, seed, box_size_x, box_size_y, box_size_z,
               receptor_method, ligand_method, parameters)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           on conflict (config_hash) do nothing""",
        (params.config_hash, params.version_label, params.engine, params.engine_version,
         params.exhaustiveness, params.num_modes, params.energy_range, params.seed,
         *params.box_size, params.receptor_method, params.ligand_method,
         json.dumps(params.canonical(), sort_keys=True)))
    return params.config_hash


def create_run(conn, params: DockingParameters, *, kind: str, name: str) -> str:
    register_configuration(conn, params)
    run_id = f"{kind[:3].upper()}-{datetime.utcnow():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
    conn.execute(
        """insert into docking.runs(run_id, run_name, kind, config_hash, engine, engine_version,
               status, configuration)
           values (%s,%s,%s,%s,%s,%s,'RUNNING',%s)""",
        (run_id, name, kind, params.config_hash, params.engine, params.engine_version,
         json.dumps(params.canonical(), sort_keys=True)))
    return run_id


def current_full_run(conn, config_hash: str) -> str | None:
    row = conn.execute(
        """select run_id from docking.runs where kind = 'full' and config_hash = %s
             and status <> 'CANCELLED' order by created_at desc limit 1""", (config_hash,)).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Enqueue
# ---------------------------------------------------------------------------

def enqueue(conn, run_id: str, config_hash: str, ligand_ids: list[str] | None = None,
            target_ids: list[str] | None = None, *, max_attempts: int = 3) -> dict[str, int]:
    """Create every missing (ligand, target) job for this configuration.

    One INSERT ... SELECT, so the cross product is built in the database and an
    existing job under the same configuration (from any run) is never
    duplicated. Jobs whose input failed preparation are created directly in
    that terminal status, carrying the preparation error, so every pair is
    accounted for and none is silently missing.

    Priority orders cheap ligands first (fewest torsions), so throughput figures
    early in a run are not mistaken for the whole run's: ETA uses measured rate,
    and the slow, flexible ligands are visibly still queued.
    """
    lig_filter = "and l.ligand_id = any(%(ligs)s)" if ligand_ids is not None else \
        "and l.molecule_id is not null"
    tgt_filter = "and t.target_id = any(%(tgts)s)" if target_ids is not None else ""
    with transaction(conn):
        cur = conn.execute(
            f"""insert into docking.jobs(run_id, ligand_id, target_id, config_hash, status, priority,
                       max_attempts, error_message, completed_at)
                select %(run)s, l.ligand_id, t.target_id, %(cfg)s,
                       case when t.preparation_status = 'TARGET_PREPARATION_FAILED' then 'TARGET_PREPARATION_FAILED'
                            when l.preparation_status in ('STRUCTURE_UNAVAILABLE','LIGAND_PREPARATION_FAILED')
                                 then l.preparation_status
                            else 'QUEUED' end,
                       coalesce(l.torsions, 99) * 100 + coalesce(l.heavy_atoms, 99),
                       %(att)s,
                       case when t.preparation_status = 'TARGET_PREPARATION_FAILED' then t.preparation_error
                            when l.preparation_status in ('STRUCTURE_UNAVAILABLE','LIGAND_PREPARATION_FAILED')
                                 then l.preparation_error end,
                       case when t.preparation_status = 'TARGET_PREPARATION_FAILED'
                              or l.preparation_status in ('STRUCTURE_UNAVAILABLE','LIGAND_PREPARATION_FAILED')
                            then now() end
                  from docking.ligands l cross join docking.targets t
                 where t.selected and l.preparation_status <> 'PENDING'
                   and t.preparation_status <> 'PENDING'
                   {lig_filter} {tgt_filter}
                on conflict (ligand_id, target_id, config_hash) do nothing""",
            {"run": run_id, "cfg": config_hash, "att": max_attempts,
             "ligs": ligand_ids, "tgts": target_ids})
        created = cur.rowcount
    pending = conn.execute(
        "select count(*) from docking.ligands where preparation_status = 'PENDING'").fetchone()[0]
    return {"created": created, "ligands_still_pending": int(pending)}


def enqueue_pairs(conn, run_id: str, config_hash: str, pairs: list[tuple[str, str]],
                  *, max_attempts: int = 3) -> int:
    """Create jobs for explicit (ligand, target) pairs; existing pairs are skipped."""
    if not pairs:
        return 0
    with transaction(conn):
        cur = conn.execute(
            """insert into docking.jobs(run_id, ligand_id, target_id, config_hash, status, priority, max_attempts)
               select %s, l.ligand_id, t.target_id, %s, 'QUEUED',
                      coalesce(l.torsions, 99) * 100 + coalesce(l.heavy_atoms, 99), %s
                 from unnest(%s::text[], %s::text[]) as p(lig, tgt)
                 join docking.ligands l on l.ligand_id = p.lig and l.preparation_status = 'READY'
                 join docking.targets t on t.target_id = p.tgt and t.preparation_status = 'READY'
               on conflict (ligand_id, target_id, config_hash) do nothing""",
            (run_id, config_hash, max_attempts, [p[0] for p in pairs], [p[1] for p in pairs]))
        return cur.rowcount


# ---------------------------------------------------------------------------
# Claim / heartbeat / finish
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ClaimedJob:
    id: int
    run_id: str
    ligand_id: str
    target_id: str
    config_hash: str
    attempt_count: int
    max_attempts: int


def claim(conn, worker_id: str, lease_seconds: int, *, limit: int = 1,
          run_id: str | None = None) -> list[ClaimedJob]:
    """Atomically take up to `limit` QUEUED jobs from RUNNING runs."""
    rows = conn.execute(
        """update docking.jobs j set status = 'RUNNING', worker_id = %(w)s,
                  attempt_count = j.attempt_count + 1, started_at = now(), heartbeat_at = now(),
                  lease_expires_at = now() + make_interval(secs => %(lease)s),
                  updated_at = now(), error_message = null
            where j.id in (
                select q.id from docking.jobs q
                  join docking.runs r on r.run_id = q.run_id and r.status = 'RUNNING'
                 where q.status = 'QUEUED'
                   and (q.not_before is null or q.not_before <= now())
                   and (%(run)s::text is null or q.run_id = %(run)s)
                 order by q.priority, q.id
                 limit %(n)s
                 for update of q skip locked)
        returning j.id, j.run_id, j.ligand_id, j.target_id, j.config_hash,
                  j.attempt_count, j.max_attempts""",
        {"w": worker_id, "lease": lease_seconds, "n": limit, "run": run_id}).fetchall()
    return [ClaimedJob(*r) for r in rows]


def heartbeat(conn, worker_id: str, job_ids: list[int], lease_seconds: int) -> int:
    """Extend the lease on jobs this worker still owns. Returns how many it still owns."""
    if not job_ids:
        return 0
    cur = conn.execute(
        """update docking.jobs set heartbeat_at = now(),
                  lease_expires_at = now() + make_interval(secs => %s), updated_at = now()
            where id = any(%s) and worker_id = %s and status = 'RUNNING'""",
        (lease_seconds, job_ids, worker_id))
    return cur.rowcount


def fail(conn, job: ClaimedJob, worker_id: str, error: str, *, transient: bool,
         status: str = "DOCKING_FAILED", duration: float | None = None) -> str:
    """Record a failure. Transient failures with attempts left go back to QUEUED
    after an exponential backoff; everything else becomes terminal."""
    retry = transient and job.attempt_count < job.max_attempts
    new_status = "QUEUED" if retry else status
    conn.execute(
        """update docking.jobs set status = %s, error_message = %s, worker_id = null,
                  lease_expires_at = null, duration_seconds = %s,
                  not_before = case when %s then now() + make_interval(secs => %s) else null end,
                  completed_at = case when %s then null else now() end, updated_at = now()
            where id = %s and worker_id = %s and status = 'RUNNING'""",
        (new_status, error[:2000], duration, retry, backoff_seconds(job.attempt_count),
         retry, job.id, worker_id))
    return new_status


def release(conn, job: ClaimedJob, worker_id: str) -> None:
    """Give a job back untouched (graceful shutdown): the attempt is not counted."""
    conn.execute(
        """update docking.jobs set status = 'QUEUED', worker_id = null, lease_expires_at = null,
                  attempt_count = greatest(0, attempt_count - 1), started_at = null, updated_at = now()
            where id = %s and worker_id = %s and status = 'RUNNING'""", (job.id, worker_id))


def complete(conn, job: ClaimedJob, worker_id: str, result: dict[str, Any]) -> bool:
    """Mark the job COMPLETED and write its result in ONE statement, only if this
    worker still owns the job. Returns False (and writes nothing) otherwise.

    A single statement is atomic on its own and costs one round trip, which
    matters when the database is a continent away from the workers."""
    cols = list(result.keys())
    values = [Jsonb(v) if k == "poses" else v for k, v in result.items()]
    row = conn.execute(
        f"""with owned as (
                update docking.jobs set status = 'COMPLETED', completed_at = now(),
                       duration_seconds = %s, lease_expires_at = null, error_message = null,
                       updated_at = now()
                 where id = %s and worker_id = %s and status = 'RUNNING'
                returning id, ligand_id, target_id, config_hash)
            insert into docking.results(job_id, ligand_id, target_id, config_hash, {', '.join(cols)})
            select owned.id, owned.ligand_id, owned.target_id, owned.config_hash,
                   {', '.join(['%s'] * len(cols))}
              from owned
            returning id""",
        (result["duration_seconds"], job.id, worker_id, *values)).fetchone()
    if row is None:
        log.warning("job %s: lease lost before completion; result discarded", job.id)
        return False
    return True


# ---------------------------------------------------------------------------
# Recovery, retry, resume
# ---------------------------------------------------------------------------

def recover_stale(conn) -> dict[str, int]:
    """RUNNING jobs whose lease expired belong to a worker that is gone.
    They return to QUEUED if attempts remain, else become FAILED."""
    with transaction(conn):
        requeued = conn.execute(
            """update docking.jobs set status = 'QUEUED', worker_id = null, lease_expires_at = null,
                      error_message = 'lease expired: worker stopped heartbeating; requeued',
                      updated_at = now()
                where status = 'RUNNING' and lease_expires_at < now()
                  and attempt_count < max_attempts""").rowcount
        exhausted = conn.execute(
            """update docking.jobs set status = 'FAILED', worker_id = null, lease_expires_at = null,
                      completed_at = now(),
                      error_message = 'lease expired on the final attempt (worker died or job hung)',
                      updated_at = now()
                where status = 'RUNNING' and lease_expires_at < now()""").rowcount
    if requeued or exhausted:
        log.info("stale recovery: %d requeued, %d failed after final attempt", requeued, exhausted)
    return {"requeued": requeued, "failed": exhausted}


def retry_failed(conn, config_hash: str, *, job_ids: list[int] | None = None,
                 ligand_id: str | None = None, extra_attempts: int = 1) -> int:
    """Requeue docking failures (not input failures: those need new input)."""
    cur = conn.execute(
        """update docking.jobs set status = 'QUEUED', not_before = null, completed_at = null,
                  max_attempts = attempt_count + %s, worker_id = null, updated_at = now()
            where config_hash = %s and status = any(%s)
              and (%s::bigint[] is null or id = any(%s::bigint[]))
              and (%s::text is null or ligand_id = %s)""",
        (extra_attempts, config_hash, list(RETRYABLE_FAILURES), job_ids, job_ids, ligand_id, ligand_id))
    return cur.rowcount


def set_run_status(conn, run_id: str, status: str) -> None:
    conn.execute(
        """update docking.runs set status = %s,
                  completed_at = case when %s in ('COMPLETED','CANCELLED','FAILED') then now() else null end
            where run_id = %s""", (status, status, run_id))


def refresh_run_snapshot(conn, run_id: str) -> dict[str, int]:
    """Store the run's counts (scope: the run's configuration and library), and
    close it when no job is left to do."""
    row = conn.execute(
        """select r.config_hash, r.kind from docking.runs r where r.run_id = %s""", (run_id,)).fetchone()
    if not row:
        return {}
    cfg, kind = row
    scope = "j.run_id = %(run)s" if kind != "full" else \
        "j.config_hash = %(cfg)s and l.molecule_id is not null"
    c = conn.execute(
        f"""select count(*),
                   count(*) filter (where j.status = 'COMPLETED'),
                   count(*) filter (where j.status in ('FAILED','DOCKING_FAILED')),
                   count(*) filter (where j.status = 'QUEUED'),
                   count(*) filter (where j.status = 'RUNNING')
              from docking.jobs j join docking.ligands l on l.ligand_id = j.ligand_id
             where {scope}""", {"run": run_id, "cfg": cfg}).fetchone()
    total, done, failed, queued, running = (int(v) for v in c)
    conn.execute(
        """update docking.runs set total_jobs=%s, completed_jobs=%s, failed_jobs=%s, queued_jobs=%s
            where run_id=%s""", (total, done, failed, queued, run_id))
    if total and queued == 0 and running == 0:
        conn.execute(
            """update docking.runs set status='COMPLETED', completed_at=coalesce(completed_at, now())
                where run_id=%s and status='RUNNING'""", (run_id,))
    return {"total": total, "completed": done, "failed": failed, "queued": queued, "running": running}


# ---------------------------------------------------------------------------
# Workers registry
# ---------------------------------------------------------------------------

def register_worker(conn, worker_id: str, hostname: str, engine: str, engine_version: str,
                    concurrency: int, cpu_per_job: int, cpu_count: int) -> None:
    conn.execute(
        """insert into docking.workers(worker_id, hostname, engine, engine_version, concurrency,
               cpu_per_job, cpu_count, status)
           values (%s,%s,%s,%s,%s,%s,%s,'RUNNING')
           on conflict (worker_id) do update set status='RUNNING', last_seen_at=now()""",
        (worker_id, hostname, engine, engine_version, concurrency, cpu_per_job, cpu_count))


def worker_seen(conn, worker_id: str, *, status: str = "RUNNING", completed: int = 0,
                failed: int = 0) -> None:
    conn.execute(
        """update docking.workers set last_seen_at = now(), status = %s,
                  jobs_completed = jobs_completed + %s, jobs_failed = jobs_failed + %s
            where worker_id = %s""", (status, completed, failed, worker_id))


def wait_for_db(url: str, attempts: int = 10) -> psycopg.Connection:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return connect(url)
        except psycopg.OperationalError as exc:
            last = exc
            time.sleep(min(30, 2 ** i))
    raise RuntimeError(f"database unreachable after {attempts} attempts: {last}")
