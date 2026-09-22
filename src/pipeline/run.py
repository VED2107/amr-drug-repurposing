"""Full pipeline orchestration.

    python -m src.pipeline.run                  # everything, from ingestion to clinical
    python -m src.pipeline.run --incremental    # skip ingestion of bulk bioactivity,
                                                # process and screen only what is new
    python -m src.pipeline.run --skip-dock

A failing stage is reported and the remaining stages still run where that is
meaningful, so one unavailable external service does not sink the whole run.
"""

from __future__ import annotations

import argparse
import json
import time
from typing import Any

from ..config import load_config
from ..db import init_db, session
from ..logging_utils import get_logger, setup_logging
from . import clinical as clinical_stage
from . import dock as dock_stage
from . import ingest as ingest_stage
from . import predict as predict_stage
from . import process as process_stage
from . import train as train_stage

log = get_logger("amr.pipeline.run")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the full AMR repurposing pipeline")
    parser.add_argument("--incremental", action="store_true",
                        help="process and screen only new records; skip bulk bioactivity ingestion")
    parser.add_argument("--benchmark", action="store_true",
                        help="benchmark all candidate models during training")
    parser.add_argument("--skip-ingest", action="store_true")
    parser.add_argument("--skip-train", action="store_true")
    parser.add_argument("--skip-dock", action="store_true")
    parser.add_argument("--skip-clinical", action="store_true")
    parser.add_argument("--max-activities", type=int, default=None)
    parser.add_argument("--dock-limit", type=int, default=None)
    parser.add_argument("--clinical-limit", type=int, default=50)
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)

    started = time.time()
    outcomes: dict[str, Any] = {}

    def run_stage(name: str, fn, *fn_args) -> None:
        stage_started = time.time()
        try:
            code = fn(*fn_args)
            outcomes[name] = {
                "status": "ok" if code == 0 else f"exit {code}",
                "seconds": round(time.time() - stage_started, 1),
            }
        except Exception as exc:
            outcomes[name] = {
                "status": f"failed: {type(exc).__name__}: {exc}",
                "seconds": round(time.time() - stage_started, 1),
            }
            log.error("stage %s failed: %s", name, exc)

    if not args.skip_ingest:
        ingest_args = []
        if args.incremental:
            # Incremental runs refresh the approved-drug library (new drugs
            # appear there) but do not re-pull the bulk bioactivity corpus.
            ingest_args.append("--skip-bioactivity")
        if args.max_activities:
            ingest_args += ["--max-activities", str(args.max_activities)]
        run_stage("ingest", ingest_stage.main, ingest_args)

    run_stage("process", process_stage.main, [])

    if not args.skip_train:
        train_args = ["--benchmark"] if args.benchmark else []
        run_stage("train", train_stage.main, train_args)

    run_stage("predict", predict_stage.main, [])

    if not args.skip_dock:
        dock_args = ["--limit", str(args.dock_limit)] if args.dock_limit else []
        run_stage("dock", dock_stage.main, dock_args)

    if not args.skip_clinical:
        run_stage("clinical", clinical_stage.main, ["--limit", str(args.clinical_limit)])

    summary = {
        "total_seconds": round(time.time() - started, 1),
        "stages": outcomes,
    }
    print(json.dumps(summary, indent=2))
    log.info("pipeline finished in %.1fs", summary["total_seconds"])

    failed = [k for k, v in outcomes.items() if not str(v["status"]).startswith("ok")]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
