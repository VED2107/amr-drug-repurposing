"""Promote the best model trained on the current dataset version.

Why this exists
---------------
The registry promotes on measured performance: a challenger has to beat the
incumbent on prevalence-adjusted PR-AUC by a margin before it takes the ACTIVE
slot. That rule is correct and is not changed here.

It has one blind spot. When a *dataset* is corrected — as happened when Murcko
scaffolds were found to carry stereochemistry, letting enantiomer pairs straddle
the train/test boundary — the models retrained on the corrected data score about
the same as the incumbents, because the leak was small. The margin rule then
keeps the incumbent, which is the model whose evaluation cannot be trusted.

Between two models that perform the same, the one evaluated on a clean split is
the better model. This script makes that choice explicitly, records the reason on
the model row, and leaves an audit trail, rather than the choice being made by a
silent edit to the promotion threshold.

It promotes nothing unless the challenger is within ``--tolerance`` of the
incumbent on the comparison metric. A genuinely worse model is left alone and
reported.

Usage:
    python scripts/promote_clean_dataset_models.py --dry-run
    python scripts/promote_clean_dataset_models.py --reason "scaffold leakage fix"
"""

from __future__ import annotations

import argparse
import json
import sys

from src.config import load_config
from src.db import session
from src.ml import registry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-version", default="",
                        help="defaults to the most recently created dataset version")
    parser.add_argument("--tolerance", type=float, default=0.01,
                        help="how far below the incumbent the challenger may score and still win")
    parser.add_argument("--reason", default="dataset integrity fix")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    cfg = load_config()
    primary = cfg.get("ml", "registry", "primary_metric", default="pr_auc")

    with session(cfg) as conn:
        dataset_version = args.dataset_version
        if not dataset_version:
            row = conn.execute(
                "SELECT dataset_version FROM dataset_versions ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            if row is None:
                print("no dataset versions exist", file=sys.stderr)
                return 1
            dataset_version = row["dataset_version"]
        print(f"dataset version: {dataset_version}")

        pathogens = [p.key for p in cfg.pathogens]
        exit_code = 0

        for pathogen in pathogens:
            active = registry.get_active_model(conn, pathogen)
            challengers = conn.execute(
                """SELECT * FROM model_versions
                   WHERE pathogen_key = ? AND dataset_version = ? AND status != 'REJECTED'
                   ORDER BY created_at DESC""",
                (pathogen, dataset_version),
            ).fetchall()
            if not challengers:
                print(f"{pathogen}: no model trained on this dataset — nothing to do")
                continue

            def score(row) -> float | None:
                metrics = json.loads(row["metrics_json"] or "{}")
                return registry.comparison_metric(metrics, primary)[0]

            best = max(challengers, key=lambda r: (score(r) is not None, score(r) or -1))
            best_score = score(best)

            if active is not None and active["dataset_version"] == dataset_version:
                print(f"{pathogen}: ACTIVE {active['model_version']} already uses this dataset")
                continue
            if best_score is None:
                print(f"{pathogen}: {best['model_version']} has no comparable metric — skipped")
                exit_code = 1
                continue

            incumbent_score = score(active) if active is not None else None
            if incumbent_score is not None and best_score < incumbent_score - args.tolerance:
                print(f"{pathogen}: {best['model_version']} scores {best_score:.3f} vs incumbent "
                      f"{incumbent_score:.3f} — outside tolerance, NOT promoted")
                exit_code = 1
                continue

            incumbent_text = (
                f"{active['model_version']} ({incumbent_score:.3f} on {dataset_version_of(active)})"
                if active is not None and incumbent_score is not None else "no incumbent"
            )
            reason = (
                f"promoted on dataset integrity ({args.reason}): trained and evaluated on "
                f"{dataset_version}, scoring {best_score:.3f} on prevalence-adjusted PR-AUC "
                f"against {incumbent_text}. Performance is equivalent within {args.tolerance}; "
                f"the clean split is the tie-breaker."
            )
            print(f"{pathogen}: promote {best['model_version']} ({best_score:.3f}) "
                  f"over {incumbent_text}")
            if not args.dry_run:
                registry.promote(conn, best["model_version"], pathogen, reason)

        if args.dry_run:
            print("\ndry run — nothing was changed")
    return exit_code


def dataset_version_of(row) -> str:
    try:
        return row["dataset_version"] or "unknown dataset"
    except (KeyError, IndexError):
        return "unknown dataset"


if __name__ == "__main__":
    sys.exit(main())
