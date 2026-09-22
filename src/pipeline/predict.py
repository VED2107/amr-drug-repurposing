"""Stage 4 - screening the approved-drug library with the ACTIVE model.

This is the stage that handles new drugs. A newly ingested drug is fingerprinted
and scored with the model that already exists. It never triggers retraining: if
1,000 new drugs arrive, 1,000 predictions are produced and zero models are
retrained.

Usage:
    python -m src.pipeline.predict
    python -m src.pipeline.predict --all        # rescore everything, not just new
    python -m src.pipeline.predict --smiles "CC(=O)Oc1ccccc1C(=O)O"
"""

from __future__ import annotations

import argparse
import json
import sqlite3

from ..config import Config, load_config
from ..db import init_db, session, utcnow
from ..logging_utils import get_logger, setup_logging
from ..ml.predict import ModelCache, predict_smiles, screen_pathogen
from .runlog import PipelineRun, stage_run

log = get_logger("amr.pipeline.predict")


def screen_all(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, *,
    incremental: bool = True, approved_only: bool = True, limit: int | None = None,
) -> dict[str, dict]:
    """Screen the library against every pathogen that has an active model."""
    cache = ModelCache()
    summary: dict[str, dict] = {}

    for pathogen in cfg.pathogens:
        result = screen_pathogen(
            conn, cfg, pathogen.key, cache=cache,
            incremental=incremental, approved_only=approved_only, limit=limit,
        )
        summary[pathogen.key] = {
            "model_version": result.model_version,
            "scored": result.n_scored,
            "skipped": result.n_skipped,
            "candidates": result.n_candidates,
            "note": result.skipped_reason,
        }
        run.processed += result.n_scored
        run.new += result.n_scored
        run.skipped += result.n_skipped
        for error in result.errors[:50]:
            run.record_error(f"screen:{pathogen.key}", error)
        if result.skipped_reason:
            log.info("%s: %s", pathogen.label, result.skipped_reason)

    # Mark drugs whose molecule now carries at least one prediction.
    conn.execute(
        """UPDATE drugs SET prediction_status = 'predicted'
           WHERE molecule_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM predictions p WHERE p.molecule_id = drugs.molecule_id)"""
    )
    conn.commit()
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Screen approved drugs with the active model")
    parser.add_argument("--all", action="store_true", help="rescore every molecule, not just unscored ones")
    parser.add_argument("--include-unapproved", action="store_true",
                        help="also score molecules that are not linked to an approved product")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--smiles", type=str, default=None,
                        help="ad-hoc prediction for one structure; nothing is stored")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)

        if args.smiles:
            print(json.dumps(predict_smiles(conn, cfg, args.smiles), indent=2, default=str))
            return 0

        with stage_run(conn, "predict", params=vars(args)) as run:
            summary = screen_all(
                conn, cfg, run,
                incremental=not args.all,
                approved_only=not args.include_unapproved,
                limit=args.limit,
            )
            for key, value in summary.items():
                run.note(key, value)
            print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
