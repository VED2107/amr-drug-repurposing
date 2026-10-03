"""A long-lived docking worker.

    start -> register -> [claim -> fetch inputs -> Vina -> check -> store -> complete] x N

One process runs `DOCKING_CONCURRENCY` slots. Each slot owns one database
connection and runs one single-threaded Vina process at a time (`--cpu 1` by
default: for a fixed seed Vina's result does not depend on the thread count,
and independent single-thread jobs use the cores better than one wide job).

Receptors and ligands are fetched once per worker and cached on disk by
checksum; nothing is prepared per job. Any number of these workers, on any
number of machines, can consume the same queue.

Shutdown (SIGINT/SIGTERM): stop claiming, let running jobs finish for
`DOCKING_SHUTDOWN_GRACE` seconds, then kill Vina and hand unfinished jobs back
to the queue without counting the attempt.
"""

from __future__ import annotations

import os
import random
import signal
import socket
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from ..logging_utils import get_logger
from . import queue as q
from .artifacts import ArtifactError, ArtifactStore
from .config import DockingParameters, Settings, available_cpus
from .engine import Cancelled, EngineError, VinaRunner, engine_version

log = get_logger("amr.batchdock.worker")


@dataclass(frozen=True)
class TargetInputs:
    target_id: str
    status: str
    error: str | None
    receptor: Path | None
    receptor_sha: str | None
    center: tuple[float, float, float] | None


class Worker:
    def __init__(self, settings: Settings, params: DockingParameters, *,
                 run_id: str | None = None, max_jobs: int | None = None,
                 idle_exit_seconds: int | None = None) -> None:
        if settings.vina_binary is None:
            raise SystemExit("AutoDock Vina not found: set DOCKING_VINA_BIN")
        version = engine_version(settings.vina_binary)
        if version != params.engine_version:
            raise SystemExit(f"Vina {version} found but the configuration requires "
                             f"{params.engine_version}; refusing to mix engine versions")
        self.s, self.p = settings, params
        self.run_id, self.max_jobs, self.idle_exit = run_id, max_jobs, idle_exit_seconds
        self.store = ArtifactStore(settings)
        self.runner = VinaRunner(settings.vina_binary, params, settings.cpu_per_job,
                                 settings.timeout_seconds)
        self.stop = threading.Event()
        self._active: dict[int, q.ClaimedJob] = {}
        self._lock = threading.Lock()
        self._targets: dict[str, TargetInputs] = {}
        self._ligands: dict[str, tuple] = {}
        self._target_lock = threading.Lock()
        self._claimed_total = 0
        self.completed = 0
        self.failed = 0
        self._pending_counts = [0, 0]
        self.scratch = settings.artifact_dir / "_scratch" / settings.worker_id

    # -- inputs -----------------------------------------------------------

    def _target(self, conn, target_id: str) -> TargetInputs:
        with self._target_lock:
            if target_id in self._targets:
                return self._targets[target_id]
            row = conn.execute(
                """select t.preparation_status, t.preparation_error, a.object_key, a.sha256,
                          t.center_x, t.center_y, t.center_z, t.size_x, t.size_y, t.size_z
                     from docking.targets t left join docking.artifacts a on a.id = t.prepared_artifact_id
                    where t.target_id = %s""", (target_id,)).fetchone()
            if row is None:
                ti = TargetInputs(target_id, "TARGET_PREPARATION_FAILED", "target not registered", None, None, None)
            elif row[0] != "READY":
                ti = TargetInputs(target_id, "TARGET_PREPARATION_FAILED", row[1] or "target not prepared",
                                  None, None, None)
            else:
                if tuple(float(v) for v in row[7:10]) != tuple(self.p.box_size):
                    raise EngineError(f"target {target_id} box size {row[7:10]} differs from the "
                                      f"configuration's {self.p.box_size}", transient=False,
                                      status="TARGET_PREPARATION_FAILED")
                path = self.store.fetch(row[2], row[3])
                ti = TargetInputs(target_id, "READY", None, path, row[3], (row[4], row[5], row[6]))
            self._targets[target_id] = ti
            return ti

    def _load_ligand_index(self, conn) -> None:
        rows = conn.execute(
            """select l.ligand_id, l.preparation_status, l.preparation_error, a.object_key, a.sha256
                 from docking.ligands l left join docking.artifacts a on a.id = l.pdbqt_artifact_id""").fetchall()
        with self._target_lock:
            self._ligands = {r[0]: tuple(r[1:]) for r in rows}

    def _ligand(self, conn, ligand_id: str) -> tuple[str, str | None, Path | None, str | None]:
        cached = self._ligands.get(ligand_id)
        if cached is not None and cached[0] == "READY":
            return "READY", None, self.store.fetch(cached[2], cached[3]), cached[3]
        row = conn.execute(
            """select l.preparation_status, l.preparation_error, a.object_key, a.sha256
                 from docking.ligands l left join docking.artifacts a on a.id = l.pdbqt_artifact_id
                where l.ligand_id = %s""", (ligand_id,)).fetchone()
        if row is None:
            return "STRUCTURE_UNAVAILABLE", "ligand not registered", None, None
        if row[0] != "READY":
            return row[0], row[1], None, None
        return "READY", None, self.store.fetch(row[2], row[3]), row[3]

    # -- one job ----------------------------------------------------------

    def process(self, conn, job: q.ClaimedJob) -> str:
        t0 = time.monotonic()
        try:
            if job.config_hash != self.p.config_hash:
                q.release(conn, job, self.s.worker_id)
                return "RELEASED"
            target = self._target(conn, job.target_id)
            if target.status != "READY":
                return q.fail(conn, job, self.s.worker_id, target.error or "", transient=False,
                              status="TARGET_PREPARATION_FAILED")
            lstatus, lerror, ligand, ligand_sha = self._ligand(conn, job.ligand_id)
            if lstatus != "READY":
                return q.fail(conn, job, self.s.worker_id, lerror or "", transient=False, status=lstatus)

            out = self.scratch / f"{job.id}_out.pdbqt"
            run = self.runner.run(target.receptor, ligand, out, target.center)  # type: ignore[arg-type]

            prefix = f"poses/{self.p.config_hash[:12]}/{job.target_id}/{job.ligand_id}"
            pose = self.store.write("pose_pdbqt", f"{prefix}.pdbqt", run.pose_text.encode("utf-8"))
            logf = self.store.write("vina_log", f"{prefix}.log", run.log_text.encode("utf-8"))
            out.unlink(missing_ok=True)
            arts = self.store.register_many(conn, [pose, logf])
            pose_a, log_a = arts[pose.object_key], arts[logf.object_key]
            poses = run.poses
            result = {
                "best_affinity": run.best_affinity,
                "poses_count": len(poses),
                "rmsd_lower_bound": max(p["rmsd_lb"] for p in poses),
                "rmsd_upper_bound": max(p["rmsd_ub"] for p in poses),
                "poses": poses,
                "pose_artifact_id": pose_a.id,
                "log_artifact_id": log_a.id,
                "engine": self.p.engine,
                "engine_version": self.p.engine_version,
                "exhaustiveness": self.p.exhaustiveness,
                "num_modes": self.p.num_modes,
                "energy_range": self.p.energy_range,
                "seed": self.p.seed,
                "cpu": self.s.cpu_per_job,
                "center_x": target.center[0], "center_y": target.center[1],  # type: ignore[index]
                "center_z": target.center[2],  # type: ignore[index]
                "size_x": self.p.box_size[0], "size_y": self.p.box_size[1], "size_z": self.p.box_size[2],
                "receptor_sha256": target.receptor_sha,
                "ligand_sha256": ligand_sha,
                "command": run.command.replace(str(self.s.artifact_dir), "$ARTIFACTS"),
                "worker_id": self.s.worker_id,
                "duration_seconds": round(run.duration_seconds, 3),
            }
            ok = q.complete(conn, job, self.s.worker_id, result)
            return "COMPLETED" if ok else "LEASE_LOST"
        except Cancelled:
            q.release(conn, job, self.s.worker_id)
            return "RELEASED"
        except EngineError as exc:
            return q.fail(conn, job, self.s.worker_id, str(exc), transient=exc.transient,
                          status=exc.status, duration=time.monotonic() - t0)
        except ArtifactError as exc:
            return q.fail(conn, job, self.s.worker_id, f"artifact: {exc}", transient=True,
                          status="FAILED", duration=time.monotonic() - t0)
        except Exception as exc:  # database hiccup, disk full ...: retry with backoff
            log.exception("job %s: unexpected error", job.id)
            try:
                return q.fail(conn, job, self.s.worker_id, f"{type(exc).__name__}: {exc}",
                              transient=True, status="FAILED", duration=time.monotonic() - t0)
            except Exception:
                return "UNRECORDED"  # the lease will expire and stale recovery requeues it

    # -- slots, heartbeat, lifecycle -------------------------------------

    def _budget_left(self) -> bool:
        with self._lock:
            if self.max_jobs is None:
                return True
            if self._claimed_total >= self.max_jobs:
                return False
            self._claimed_total += 1
            return True

    def _slot(self, n: int) -> None:
        conn = None
        idle_since = time.monotonic()
        while not self.stop.is_set():
            try:
                if conn is None or conn.closed:
                    conn = q.wait_for_db(self.s.database_url)
                if not self._budget_left():
                    break
                jobs = q.claim(conn, self.s.worker_id, self.s.lease_seconds, limit=1, run_id=self.run_id)
                if not jobs:
                    with self._lock:
                        if self.max_jobs is not None:
                            self._claimed_total -= 1
                    if self.idle_exit and time.monotonic() - idle_since > self.idle_exit:
                        break
                    self.stop.wait(3 + random.random() * 4)
                    continue
                idle_since = time.monotonic()
                job = jobs[0]
                with self._lock:
                    self._active[job.id] = job
                try:
                    status = self.process(conn, job)
                finally:
                    with self._lock:
                        self._active.pop(job.id, None)
                with self._lock:
                    if status == "COMPLETED":
                        self.completed += 1
                        self._pending_counts[0] += 1
                    elif status not in ("RELEASED", "QUEUED"):
                        self.failed += 1
                        self._pending_counts[1] += 1
                log.info("slot %d job %s %s/%s -> %s", n, job.id, job.ligand_id, job.target_id, status)
            except Exception:
                log.exception("slot %d: error; reconnecting", n)
                try:
                    if conn is not None:
                        conn.close()
                except Exception:
                    pass
                conn = None
                self.stop.wait(5)
        if conn is not None:
            conn.close()

    def _heartbeat(self) -> None:
        conn = None
        last_recovery = 0.0
        while True:
            if self.stop.is_set():
                if not self._active:
                    break
                time.sleep(5)  # keep leases alive while running jobs finish
            else:
                self.stop.wait(self.s.heartbeat_seconds)
            try:
                if conn is None or conn.closed:
                    conn = q.wait_for_db(self.s.database_url)
                with self._lock:
                    ids = list(self._active)
                    done, failed = self._pending_counts
                    self._pending_counts = [0, 0]
                q.heartbeat(conn, self.s.worker_id, ids, self.s.lease_seconds)
                q.worker_seen(conn, self.s.worker_id, completed=done, failed=failed,
                              status="STOPPING" if self.stop.is_set() else "RUNNING")
                if time.monotonic() - last_recovery > 60:
                    q.recover_stale(conn)
                    last_recovery = time.monotonic()
            except Exception:
                log.exception("heartbeat failed; retrying")
                conn = None
        if conn is not None:
            conn.close()

    def request_stop(self, *_args) -> None:
        if not self.stop.is_set():
            log.info("shutdown requested: no new jobs; %d running", len(self._active))
            self.stop.set()
            grace = int(os.environ.get("DOCKING_SHUTDOWN_GRACE", "20"))
            threading.Timer(grace, self.runner.kill_all).start()

    def run(self) -> dict[str, int]:
        self.scratch.mkdir(parents=True, exist_ok=True)
        conn = q.wait_for_db(self.s.database_url)
        q.register_worker(conn, self.s.worker_id, socket.gethostname(), self.p.engine,
                          self.p.engine_version, self.s.concurrency, self.s.cpu_per_job, available_cpus(),
                          kind=self.s.worker_kind, session_label=self.s.session_label)
        q.recover_stale(conn)
        self._load_ligand_index(conn)
        conn.close()
        log.info("worker started: %s config=%s", self.s.describe(), self.p.config_hash[:12])
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGINT, self.request_stop)
            signal.signal(signal.SIGTERM, self.request_stop)
        hb = threading.Thread(target=self._heartbeat, name="heartbeat", daemon=True)
        hb.start()
        slots = [threading.Thread(target=self._slot, args=(i,), name=f"slot-{i}")
                 for i in range(self.s.concurrency)]
        for t in slots:
            t.start()
        for t in slots:
            t.join()
        self.stop.set()
        hb.join(timeout=30)
        conn = q.wait_for_db(self.s.database_url)
        with self._lock:
            done, failed = self._pending_counts
        q.worker_seen(conn, self.s.worker_id, status="STOPPED", completed=done, failed=failed)
        conn.close()
        self.store.close()
        log.info("worker stopped: %d completed, %d failed", self.completed, self.failed)
        return {"completed": self.completed, "failed": self.failed}
