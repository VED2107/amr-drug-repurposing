"""Find how many parallel Vina slots a machine sustains, using real queue jobs.

    python -m src.batchdock calibrate --max-slots 4 --jobs-per-slot 3

For n = 1 .. max_slots it runs a worker with n slots that claims exactly
`n * jobs_per_slot` jobs from the production queue, then stops. Every job is a
normal production job: claimed with SKIP LOCKED, leased, docked with the
configuration's parameters, checked and stored. Nothing is docked twice and
nothing is thrown away, so calibration costs no work.

Per phase it records how many jobs completed, how many failed, and the mean
Vina wall time per job. Jobs are claimed in priority order (torsions, then
heavy atoms), so consecutive phases dock ligands of similar size.

The steady-state rate of a phase is `n / mean job seconds` (jobs per second
with every slot busy); the tail of a phase, where some slots have already
stopped, does not distort it. The chosen slot count is the one with the
highest steady-state rate among phases with no failures. It never exceeds the
CPUs the process may use divided by `cpu_per_job`, so the CPU is not
oversubscribed.

Scientific parameters are not touched: thread count per job is operational
(Vina's result for a fixed seed does not depend on it), and the slot count only
decides how many single-threaded Vina processes run side by side.
"""

from __future__ import annotations

import dataclasses
import time
from typing import Any

from ..logging_utils import get_logger
from . import queue as q
from .config import DockingParameters, Settings, available_cpus
from .worker import Worker

log = get_logger("amr.batchdock.calibrate")


def calibrate(settings: Settings, params: DockingParameters, *, max_slots: int = 4,
              jobs_per_slot: int = 3) -> dict[str, Any]:
    cpus = available_cpus()
    ceiling = max(1, min(max_slots, cpus // max(1, settings.cpu_per_job)))
    phases: list[dict[str, Any]] = []
    for n in range(1, ceiling + 1):
        s = dataclasses.replace(settings, concurrency=n, worker_id=f"{settings.worker_id}-cal{n}")
        w = Worker(s, params, max_jobs=n * jobs_per_slot, idle_exit_seconds=60)
        t0 = time.monotonic()
        w.run()
        wall = time.monotonic() - t0
        conn = q.wait_for_db(settings.database_url)
        try:
            row = conn.execute(
                """select count(*) filter (where status = 'COMPLETED'),
                          avg(duration_seconds) filter (where status = 'COMPLETED')
                     from docking.jobs where worker_id = %s and config_hash = %s""",
                (s.worker_id, params.config_hash)).fetchone()
        finally:
            conn.close()
        done, mean = int(row[0]), (float(row[1]) if row[1] is not None else None)
        phase = {
            "slots": n, "claimed_limit": n * jobs_per_slot, "completed": done,
            "failed": w.failed, "wall_seconds": round(wall, 1),
            "mean_job_seconds": round(mean, 1) if mean else None,
            "steady_jobs_per_minute": round(60 * n / mean, 2) if mean else None,
            "observed_jobs_per_minute": round(60 * done / wall, 2) if wall else None,
        }
        phases.append(phase)
        log.info("calibration phase: %s", phase)
        if done == 0:
            break  # queue empty or the worker cannot run; more slots will not tell us anything
    stable = [p for p in phases if p["failed"] == 0 and p["steady_jobs_per_minute"]]
    best = max(stable, key=lambda p: (p["steady_jobs_per_minute"], p["slots"])) if stable else None
    return {
        "cpus": cpus, "cpu_per_job": settings.cpu_per_job, "max_slots_tested": ceiling,
        "phases": phases,
        "chosen_slots": best["slots"] if best else 1,
        "reason": ("highest steady-state rate among phases without failures" if best
                   else "no phase completed cleanly; falling back to 1 slot"),
    }
