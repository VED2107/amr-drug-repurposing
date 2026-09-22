"""Regenerate stored ROC / PR curve points for existing model versions.

Curve storage was added after some models were trained. Their curves are not
lost: they are fully determined by the saved model artefact and the recorded
test partition of their dataset version, so they can be recomputed exactly.

This recomputes an existing evaluation from stored inputs. It does not retrain,
does not change any metric, and does not alter which model is ACTIVE. If the
recomputed ROC-AUC disagrees with the stored one, the model is skipped and the
disagreement reported, because that would mean the inputs are not what the
record claims.

    python scripts/backfill_curves.py            # all models missing curves
    python scripts/backfill_curves.py --active   # only the ACTIVE models
    python scripts/backfill_curves.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.chemistry.fingerprints import fingerprint_from_blob  # noqa: E402
from src.config import load_config  # noqa: E402
from src.db import init_db, session  # noqa: E402
from src.logging_utils import get_logger, setup_logging  # noqa: E402
from src.ml import models as zoo  # noqa: E402
from src.ml.evaluate import (  # noqa: E402
    calibration_bins,
    curve_points,
    downsample_curve,
    evaluate_predictions,
)
from src.ml.predict import ModelCache  # noqa: E402

log = get_logger("amr.backfill")

#: Tolerance when checking the recomputed evaluation against the stored one.
METRIC_TOLERANCE = 1e-6


def backfill(conn, cfg, *, active_only: bool, dry_run: bool) -> dict[str, int]:
    where = "curves_json IS NULL"
    if active_only:
        where += " AND status = 'ACTIVE'"
    rows = conn.execute(
        f"""SELECT model_version, pathogen_key, dataset_version, artifact_path, metrics_json
            FROM model_versions WHERE {where} ORDER BY pathogen_key, model_version"""
    ).fetchall()

    counts = {"considered": len(rows), "written": 0, "skipped": 0, "mismatched": 0}
    if not rows:
        log.info("no model versions need curve backfill")
        return counts

    cache = ModelCache()
    n_bits = int(cfg.get("chemistry", "fingerprint", "n_bits", default=1024))

    for row in rows:
        version = row["model_version"]
        if not row["artifact_path"] or not Path(row["artifact_path"]).exists():
            log.warning("%s: artefact missing, cannot recompute", version)
            counts["skipped"] += 1
            continue

        members = conn.execute(
            """SELECT dm.label, m.fingerprint
               FROM dataset_members dm
               JOIN molecules m ON m.molecule_id = dm.molecule_id
               WHERE dm.dataset_version = ? AND dm.pathogen_key = ? AND dm.split = 'test'
               ORDER BY dm.molecule_id""",
            (row["dataset_version"], row["pathogen_key"]),
        ).fetchall()

        if not members:
            log.warning("%s: no recorded test partition, cannot recompute", version)
            counts["skipped"] += 1
            continue

        try:
            bundle = cache.load(row["artifact_path"])
            X = np.vstack([fingerprint_from_blob(r["fingerprint"], n_bits) for r in members])
            y = np.array([int(r["label"]) for r in members])
            probabilities = zoo.predict_proba(bundle["model"], X.astype(np.float32))
        except Exception as exc:
            log.warning("%s: recomputation failed (%s: %s)", version, type(exc).__name__, exc)
            counts["skipped"] += 1
            continue

        recomputed = evaluate_predictions(y, probabilities)
        stored = json.loads(row["metrics_json"] or "{}")

        # The recomputed evaluation must reproduce the stored one. If it does
        # not, the artefact or the split is not what the record says, and
        # writing curves from it would attach a misleading chart to the model.
        stored_roc = stored.get("roc_auc")
        new_roc = recomputed.get("roc_auc")
        if (
            isinstance(stored_roc, (int, float))
            and isinstance(new_roc, (int, float))
            and abs(stored_roc - new_roc) > METRIC_TOLERANCE
        ):
            log.error(
                "%s: recomputed ROC-AUC %.6f does not match the stored %.6f; skipping",
                version, new_roc, stored_roc,
            )
            counts["mismatched"] += 1
            continue

        raw = curve_points(y, probabilities)
        payload = {
            "test": {
                "roc": downsample_curve(raw.get("roc")),
                "pr": downsample_curve(raw.get("pr")),
            },
            "calibration": calibration_bins(y, probabilities),
            "regenerated": True,
        }

        log.info("%s: curves recomputed from %d test compounds", version, len(y))
        if not dry_run:
            conn.execute(
                "UPDATE model_versions SET curves_json = ? WHERE model_version = ?",
                (json.dumps(payload, default=str), version),
            )
        counts["written"] += 1

    if not dry_run:
        conn.commit()
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Regenerate stored model curve points")
    parser.add_argument("--active", action="store_true", help="only the ACTIVE models")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))

    with session(cfg) as conn:
        init_db(conn, cfg)
        counts = backfill(conn, cfg, active_only=args.active, dry_run=args.dry_run)

    print(json.dumps(counts, indent=2))
    return 1 if counts["mismatched"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
