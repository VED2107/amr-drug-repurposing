"""Command line for batch docking.

    python -m src.batchdock migrate          create/upgrade the docking schema
    python -m src.batchdock prepare          prepare all targets and all 1,761 ligands, once
    python -m src.batchdock validation-run   dock known pairs + redock crystal ligands; gate for the full run
    python -m src.batchdock benchmark --jobs 50 --concurrency 7
    python -m src.batchdock enqueue          create every missing medicine x target job
    python -m src.batchdock worker           long-lived worker; run as many as you like, anywhere
    python -m src.batchdock status [--json]  progress, from the database
    python -m src.batchdock resume           recover stale jobs, unpause the run
    python -m src.batchdock pause
    python -m src.batchdock retry-failed [--job-id N ...] [--ligand ID]
    python -m src.batchdock validate [--deep]   quality-control checks (exit 1 on error)

Environment: DOCKING_DATABASE_URL (or DATABASE_URL), DOCKING_CONCURRENCY,
DOCKING_EXHAUSTIVENESS, DOCKING_TIMEOUT, DOCKING_RETRIES, DOCKING_CPU_PER_JOB,
DOCKING_ARTIFACT_DIR, DOCKING_VINA_BIN, SUPABASE_URL + SUPABASE_SECRET_KEY
(shared artifact storage), DOCKING_STORAGE_BUCKET.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import random
import sys
import time

from ..logging_utils import get_logger, setup_logging
from . import queue as q
from .artifacts import ArtifactStore
from .config import load_settings, parameters_from_env, PROJECT_ROOT
from .prepare import library_ligand_inputs, prepare_ligands, prepare_targets
from .progress import campaign_status, format_status

log = get_logger("amr.batchdock.cli")


def _cpu_times() -> tuple[float, float] | None:
    try:
        with open("/proc/stat") as fh:
            parts = [float(v) for v in fh.readline().split()[1:]]
        idle = parts[3] + parts[4]
        return sum(parts), idle
    except OSError:
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.batchdock")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    p = sub.add_parser("prepare")
    p.add_argument("--force", action="store_true")
    p.add_argument("--targets-only", action="store_true")
    p.add_argument("--ligands-only", action="store_true")
    sub.add_parser("validation-run")
    b = sub.add_parser("benchmark")
    b.add_argument("--jobs", type=int, required=True)
    b.add_argument("--concurrency", type=int, required=True)
    b.add_argument("--seed", type=int, default=0)
    e = sub.add_parser("enqueue")
    e.add_argument("--name", default="Full library: 1,761 medicines x selected AMR targets")
    e.add_argument("--skip-validation-gate", action="store_true",
                   help="testing only; the production full run requires a passed validation run")
    w = sub.add_parser("worker")
    w.add_argument("--run-id")
    w.add_argument("--max-jobs", type=int)
    w.add_argument("--idle-exit", type=int, help="exit after this many idle seconds")
    s = sub.add_parser("status")
    s.add_argument("--json", action="store_true")
    sub.add_parser("resume")
    sub.add_parser("pause")
    r = sub.add_parser("retry-failed")
    r.add_argument("--job-id", type=int, action="append")
    r.add_argument("--ligand")
    v = sub.add_parser("validate")
    v.add_argument("--deep", action="store_true")
    args = ap.parse_args(argv)

    setup_logging(PROJECT_ROOT / "logs")
    settings = load_settings()
    params = parameters_from_env()
    conn = q.wait_for_db(settings.database_url)
    try:
        if args.cmd == "migrate":
            q.migrate(conn)
            q.register_configuration(conn, params)
            ArtifactStore(settings).ensure_bucket()
            print(f"schema ready; configuration {params.config_hash[:16]} ({params.version_label})")
            return 0

        if args.cmd == "prepare":
            store = ArtifactStore(settings)
            store.ensure_bucket()
            if not args.ligands_only:
                print("targets:", prepare_targets(conn, store, params, force=args.force))
            if not args.targets_only:
                counts = prepare_ligands(conn, store, params, library_ligand_inputs(conn), force=args.force)
                print("ligands prepared this time:", counts)
            st = campaign_status(conn, params.config_hash)
            print("ligands now:", st["ligands"], "targets now:", st["targets"])
            return 0

        if args.cmd == "validation-run":
            from .validation import validation_run
            report = validation_run(conn, settings, params)
            print(json.dumps(report, indent=2, default=str))
            return 0 if report.get("passed") else 1

        if args.cmd == "benchmark":
            from .worker import Worker
            ready_l = [r[0] for r in conn.execute(
                "select ligand_id from docking.ligands where molecule_id is not null and preparation_status='READY'")]
            ready_t = [r[0] for r in conn.execute(
                "select target_id from docking.targets where selected and preparation_status='READY'")]
            taken = {(a, b) for a, b in conn.execute(
                "select ligand_id, target_id from docking.jobs where config_hash=%s", (params.config_hash,))}
            pool = [(l, t) for l in ready_l for t in ready_t if (l, t) not in taken]
            rng = random.Random(args.seed or time.time_ns())
            pairs = rng.sample(pool, min(args.jobs, len(pool)))
            run_id = q.create_run(conn, params, kind="benchmark",
                                  name=f"Benchmark: {len(pairs)} random jobs, {args.concurrency} slots")
            n = q.enqueue_pairs(conn, run_id, params.config_hash, pairs)
            bsettings = dataclasses.replace(settings, concurrency=args.concurrency)
            cpu0, t0 = _cpu_times(), time.monotonic()
            Worker(bsettings, params, run_id=run_id, idle_exit_seconds=10).run()
            wall = time.monotonic() - t0 - 10  # minus the idle-exit wait
            cpu1 = _cpu_times()
            row = conn.execute(
                """select count(*) filter (where status='COMPLETED'), count(*) filter (where status<>'COMPLETED'),
                          avg(duration_seconds) filter (where status='COMPLETED'),
                          percentile_cont(0.5) within group (order by duration_seconds)
                            filter (where status='COMPLETED'),
                          max(duration_seconds),
                          extract(epoch from max(completed_at) - min(started_at))
                     from docking.jobs where run_id=%s""", (run_id,)).fetchone()
            done, notdone, avg, med, mx, span = row
            span = float(span or wall)
            util = None
            if cpu0 and cpu1:
                tot, idle = cpu1[0] - cpu0[0], cpu1[1] - cpu0[1]
                util = round(100 * (1 - idle / tot), 1) if tot else None
            report = {"run_id": run_id, "jobs": n, "completed": int(done), "not_completed": int(notdone),
                      "concurrency": args.concurrency, "cpus_visible": __import__("os").cpu_count(),
                      "wall_seconds": round(span, 1),
                      "jobs_per_minute": round(60 * int(done) / span, 2) if span else None,
                      "mean_job_seconds": round(float(avg), 1) if avg else None,
                      "median_job_seconds": round(float(med), 1) if med else None,
                      "max_job_seconds": round(float(mx), 1) if mx else None,
                      "cpu_utilisation_percent": util}
            conn.execute("update docking.runs set validation_report=%s, status='COMPLETED', completed_at=now() "
                         "where run_id=%s", (json.dumps(report), run_id))
            q.refresh_run_snapshot(conn, run_id)
            print(json.dumps(report, indent=2))
            return 0

        if args.cmd == "enqueue":
            from .validation import latest_validation
            v = latest_validation(conn, params.config_hash)
            if not args.skip_validation_gate and not (v and v[1]):
                print("refusing: no passed validation run for this configuration. "
                      "Run `validation-run` first.", file=sys.stderr)
                return 2
            run_id = q.current_full_run(conn, params.config_hash) or \
                q.create_run(conn, params, kind="full", name=args.name)
            res = q.enqueue(conn, run_id, params.config_hash, max_attempts=settings.max_attempts)
            q.refresh_run_snapshot(conn, run_id)
            print(f"run {run_id}: {res['created']} new jobs created; "
                  f"ligands still pending preparation: {res['ligands_still_pending']}")
            print(format_status(campaign_status(conn, params.config_hash)))
            return 0

        if args.cmd == "worker":
            from .worker import Worker
            result = Worker(settings, params, run_id=args.run_id, max_jobs=args.max_jobs,
                            idle_exit_seconds=args.idle_exit).run()
            run_id = q.current_full_run(conn, params.config_hash)
            if run_id:
                q.refresh_run_snapshot(conn, run_id)
            print(json.dumps(result))
            return 0

        if args.cmd == "status":
            st = campaign_status(conn, params.config_hash)
            print(json.dumps(st, indent=2) if args.json else format_status(st))
            return 0

        if args.cmd in ("resume", "pause"):
            run_id = q.current_full_run(conn, params.config_hash)
            if not run_id:
                print("no full run exists yet; run `enqueue`", file=sys.stderr)
                return 2
            if args.cmd == "pause":
                q.set_run_status(conn, run_id, "PAUSED")
                print(f"{run_id} paused: workers finish their current job and claim nothing new")
                return 0
            rec = q.recover_stale(conn)
            q.set_run_status(conn, run_id, "RUNNING")
            created = q.enqueue(conn, run_id, params.config_hash, max_attempts=settings.max_attempts)
            snap = q.refresh_run_snapshot(conn, run_id)
            print(f"{run_id} resumed: {rec['requeued']} stale jobs requeued, {created['created']} missing "
                  f"jobs created; {snap.get('completed', 0)} completed jobs are kept and not re-run. "
                  "Start workers with `worker` (or `docker compose up -d docking-worker`).")
            return 0

        if args.cmd == "retry-failed":
            n = q.retry_failed(conn, params.config_hash, job_ids=args.job_id, ligand_id=args.ligand)
            run_id = q.current_full_run(conn, params.config_hash)
            if run_id:
                q.set_run_status(conn, run_id, "RUNNING")
            print(f"{n} docking failures requeued (input failures are not retried: they need new input)")
            return 0

        if args.cmd == "validate":
            from .validation import qc
            result = qc(conn, ArtifactStore(settings), params.config_hash, deep=args.deep)
            print(json.dumps(result, indent=2, default=str))
            return 0 if result["ok"] else 1
    finally:
        conn.close()
    return 0
