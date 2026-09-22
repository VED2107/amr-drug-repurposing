"""Stage 3 - dataset versioning, training, benchmarking and promotion.

Retraining is triggered by NEW LABELLED BIOACTIVITY DATA, never by the arrival
of a new drug. A new drug is screened with the existing model (see
``src.pipeline.predict``).

Usage:
    python -m src.pipeline.train                 # baseline only
    python -m src.pipeline.train --benchmark     # full model comparison
    python -m src.pipeline.train --check         # report whether retraining is due
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from typing import Any

from ..config import Config, load_config
from ..db import get_setting, init_db, session, set_setting
from ..logging_utils import get_logger, setup_logging
from ..ml import registry
from ..ml.dataset import build_pathogen_dataset, create_dataset_version
from ..ml.train import train_pathogen
from .runlog import STATUS_SKIPPED, PipelineRun, stage_run

log = get_logger("amr.pipeline.train")


def retraining_status(conn: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    """Report whether new labelled data justifies retraining.

    The trigger is the count of labelled bioactivity records compared with the
    count captured when the active dataset version was built.
    """
    current_labelled = conn.execute(
        "SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL"
    ).fetchone()[0]

    active_dataset = get_setting(conn, "active_dataset_version")
    baseline_count = get_setting(conn, "labelled_records_at_last_training")
    try:
        baseline_count = int(baseline_count) if baseline_count is not None else None
    except (TypeError, ValueError):
        baseline_count = None

    new_records = (current_labelled - baseline_count) if baseline_count is not None else current_labelled

    per_pathogen = []
    for p in cfg.pathogens:
        active = registry.get_active_model(conn, p.key)
        per_pathogen.append(
            {
                "pathogen": p.key,
                "label": p.label,
                "active_model": active["model_version"] if active else None,
                "model_type": active["model_type"] if active else None,
                "dataset_version": active["dataset_version"] if active else None,
                "trained_at": active["training_date"] if active else None,
            }
        )

    return {
        "labelled_records_now": int(current_labelled),
        "labelled_records_at_last_training": baseline_count,
        "new_labelled_records": int(new_records),
        "active_dataset_version": active_dataset,
        "retraining_recommended": bool(new_records > 0),
        "trigger_rule": "retraining is driven by new labelled bioactivity data, not by new drugs",
        "pathogens": per_pathogen,
    }


def run_training(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, *, benchmark: bool
) -> dict[str, Any]:
    """Build a dataset version and train every trainable pathogen."""
    datasets = {}
    untrainable = {}

    for pathogen in cfg.pathogens:
        ds = build_pathogen_dataset(conn, cfg, pathogen.key)
        log.info(
            "%s: %d labelled compounds (%d active / %d inactive) - %s",
            pathogen.label, ds.n, ds.n_active, ds.n_inactive, ds.reason,
        )
        if ds.trainable:
            datasets[pathogen.key] = ds
        else:
            untrainable[pathogen.key] = ds.reason
            # Still record the pathogen's data so the dashboard can explain the gap.
            datasets[pathogen.key] = ds

    if not any(ds.trainable for ds in datasets.values()):
        run.status = STATUS_SKIPPED
        run.message = "no pathogen has sufficient labelled data to train a model"
        return {"dataset_version": None, "results": {}, "untrainable": untrainable}

    dataset_version = create_dataset_version(conn, cfg, datasets, notes="built by src.pipeline.train")
    set_setting(conn, "active_dataset_version", dataset_version)

    results: dict[str, Any] = {}
    for key, ds in datasets.items():
        if not ds.trainable:
            results[key] = {"trained": False, "reason": ds.reason}
            run.skipped += 1
            continue
        try:
            outcome = train_pathogen(conn, cfg, ds, dataset_version, benchmark=benchmark)
            run.processed += 1
            if outcome.trained:
                run.new += 1
            results[key] = {
                "trained": outcome.trained,
                "reason": outcome.reason,
                "selected_model": outcome.selected_model_version,
                "promoted": outcome.promoted,
                "promotion_reason": outcome.promotion_reason,
                "split": outcome.split_summary,
                "leakage": outcome.leakage,
                "candidates": [
                    {
                        "model": c.model_key,
                        "selected": c.selected,
                        "baseline": c.is_baseline,
                        "model_version": c.model_version,
                        "test_pr_auc": c.test_metrics.get("pr_auc"),
                        "test_roc_auc": c.test_metrics.get("roc_auc"),
                        "error": c.error,
                    }
                    for c in outcome.candidates
                ],
            }
        except Exception as exc:
            run.record_error(f"train:{key}", exc)
            results[key] = {"trained": False, "reason": f"{type(exc).__name__}: {exc}"}

    labelled_now = conn.execute("SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL").fetchone()[0]
    set_setting(conn, "labelled_records_at_last_training", str(int(labelled_now)))
    conn.commit()

    return {"dataset_version": dataset_version, "results": results, "untrainable": untrainable}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train and benchmark models")
    parser.add_argument("--benchmark", action="store_true",
                        help="train and compare all configured candidate models")
    parser.add_argument("--check", action="store_true",
                        help="report retraining status without training")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)

        if args.check:
            status = retraining_status(conn, cfg)
            print(json.dumps(status, indent=2))
            return 0

        with stage_run(conn, "train", params=vars(args)) as run:
            outcome = run_training(conn, cfg, run, benchmark=args.benchmark)
            run.note("dataset_version", outcome["dataset_version"])
            for key, res in outcome["results"].items():
                run.note(
                    key,
                    {
                        "trained": res.get("trained"),
                        "model": res.get("selected_model"),
                        "promoted": res.get("promoted"),
                    },
                )
            print(json.dumps(outcome, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
