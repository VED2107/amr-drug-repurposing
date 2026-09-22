"""Training, benchmarking and model selection.

Protocol
--------
1. Split the dataset once, scaffold-aware: TRAIN / VALIDATION / TEST.
2. Train every candidate model on TRAIN. Evaluate on VALIDATION.
   Selection uses VALIDATION only - the test set is never consulted while
   choosing a model, which is what makes the final number honest.
3. Cross-validate each candidate on TRAIN for a stability estimate.
4. Select the best model on the configured primary validation metric.
5. Refit the selected model on TRAIN + VALIDATION and evaluate ONCE on TEST.
   For the comparison table, every candidate is also refit and scored on TEST
   at this same final step, so the table reports like-for-like numbers.
6. Compare against the incumbent ACTIVE model and promote only if the
   acceptance criteria pass.

Random Forest is always trained and always recorded as the baseline, whether or
not it wins.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.model_selection import StratifiedKFold

from ..config import PROJECT_ROOT, Config
from ..db import utcnow
from ..logging_utils import get_logger
from . import models as zoo
from . import registry
from .dataset import PathogenDataset, record_splits
from .evaluate import (
    calibration_bins,
    curve_points,
    downsample_curve,
    evaluate_predictions,
    summarize_for_table,
)
from .splits import check_leakage, make_split

log = get_logger("amr.train")


@dataclass
class CandidateResult:
    """One model trained and evaluated within a benchmark run."""

    model_key: str
    display_name: str
    is_baseline: bool
    validation_metrics: dict[str, Any] = field(default_factory=dict)
    test_metrics: dict[str, Any] = field(default_factory=dict)
    cv_metrics: dict[str, Any] = field(default_factory=dict)
    model_version: str | None = None
    artifact_path: str | None = None
    selected: bool = False
    error: str | None = None


@dataclass
class PathogenTrainingResult:
    """Everything produced for one pathogen in a benchmark run."""

    pathogen_key: str
    trained: bool
    reason: str
    benchmark_run_id: str | None = None
    candidates: list[CandidateResult] = field(default_factory=list)
    selected_model_version: str | None = None
    promoted: bool = False
    promotion_reason: str = ""
    split_summary: dict[str, Any] = field(default_factory=dict)
    leakage: dict[str, Any] = field(default_factory=dict)


def _cross_validate(
    model_key: str, params: dict[str, Any], X: np.ndarray, y: np.ndarray,
    *, folds: int, seed: int, class_weight: str | None
) -> dict[str, Any]:
    """Stratified CV on the training partition only."""
    minority = int(min(np.sum(y == 0), np.sum(y == 1)))
    n_splits = max(2, min(folds, minority))
    if minority < 2:
        return {"error": "too few minority-class examples for cross-validation"}

    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    roc, pr, f1 = [], [], []

    for train_idx, val_idx in skf.split(X, y):
        try:
            model = zoo.build(model_key, params, seed=seed, class_weight=class_weight)
            model.fit(X[train_idx], y[train_idx])
            prob = zoo.predict_proba(model, X[val_idx])
            m = evaluate_predictions(y[val_idx], prob)
        except Exception as exc:
            log.debug("CV fold failed for %s: %s", model_key, exc)
            continue
        if m.get("roc_auc") is not None:
            roc.append(m["roc_auc"])
        if m.get("pr_auc") is not None:
            pr.append(m["pr_auc"])
        if m.get("f1") is not None:
            f1.append(m["f1"])

    def stat(values: list[float]) -> dict[str, float] | None:
        if not values:
            return None
        return {"mean": float(np.mean(values)), "std": float(np.std(values)), "n_folds": len(values)}

    return {"n_splits": n_splits, "roc_auc": stat(roc), "pr_auc": stat(pr), "f1": stat(f1)}


def train_pathogen(
    conn: sqlite3.Connection,
    cfg: Config,
    ds: PathogenDataset,
    dataset_version: str,
    *,
    benchmark: bool = True,
    models_dir: Path | None = None,
) -> PathogenTrainingResult:
    """Run the full protocol for one pathogen."""
    if not ds.trainable or ds.fingerprints is None or ds.n == 0:
        return PathogenTrainingResult(ds.pathogen_key, False, ds.reason or "dataset not trainable")

    seed = cfg.seed
    feature_version = cfg.get("ml", "feature_version", default="morgan-r2-1024-v1")
    class_weight = cfg.get("ml", "class_weight", default="balanced")
    split_cfg = cfg.get("ml", "split", default={}) or {}
    sel_cfg = cfg.get("ml", "selection", default={}) or {}
    primary = sel_cfg.get("primary_metric", "pr_auc")
    tie_breakers = list(sel_cfg.get("tie_breakers", []))
    models_dir = models_dir or cfg.path_for("models")
    models_dir.mkdir(parents=True, exist_ok=True)

    X = np.asarray(ds.fingerprints, dtype=np.float32)
    y = np.asarray(ds.labels, dtype=int)

    split = make_split(
        method=split_cfg.get("method", "scaffold"),
        scaffolds=ds.scaffolds,
        labels=ds.labels,
        test_fraction=float(split_cfg.get("test_fraction", 0.2)),
        validation_fraction=float(split_cfg.get("validation_fraction", 0.15)),
        seed=seed,
    )

    if split.train_idx.size == 0 or split.test_idx.size == 0:
        return PathogenTrainingResult(
            ds.pathogen_key, False,
            f"split produced an empty partition: {split.sizes()}",
        )

    # Persist the split so the reported metrics can be reproduced exactly.
    assignment = ["train"] * ds.n
    for i in split.val_idx:
        assignment[int(i)] = "validation"
    for i in split.test_idx:
        assignment[int(i)] = "test"
    record_splits(conn, dataset_version, ds.pathogen_key, ds.molecule_ids, assignment)

    leakage = check_leakage(
        [ds.molecule_ids[int(i)] for i in split.train_idx],
        [ds.molecule_ids[int(i)] for i in split.test_idx],
    )
    if not leakage["clean"]:
        log.warning("%s: %d molecules appear in both train and test", ds.pathogen_key, leakage["n_overlap"])

    result = PathogenTrainingResult(
        ds.pathogen_key, True, "training completed",
        benchmark_run_id=f"BM-{uuid.uuid4().hex[:10]}",
        split_summary={
            **split.sizes(),
            "method": split.method,
            "seed": split.seed,
            "n_scaffolds": split.n_scaffolds,
            "notes": split.notes,
        },
        leakage=leakage,
    )

    requested = list(cfg.get("ml", "benchmark_models", default=[zoo.BASELINE_MODEL]))
    if not benchmark:
        requested = [zoo.BASELINE_MODEL]

    specs, skipped = zoo.resolve_specs(
        requested,
        n_rows=int(split.train_idx.size),
        min_rows_for_boosting=int(cfg.get("ml", "min_rows_for_boosting", default=800)),
    )
    for entry in skipped:
        log.info("%s: skipping %s (%s)", ds.pathogen_key, entry["model"], entry["reason"])

    X_train, y_train = X[split.train_idx], y[split.train_idx]
    X_val, y_val = X[split.val_idx], y[split.val_idx]
    X_test, y_test = X[split.test_idx], y[split.test_idx]
    X_fit_final = np.vstack([X_train, X_val]) if X_val.size else X_train
    y_fit_final = np.concatenate([y_train, y_val]) if y_val.size else y_train

    folds = int(split_cfg.get("cv_folds", 5))

    # ---- stage 1: train on TRAIN, score on VALIDATION (selection only) ----
    for spec in specs:
        params = cfg.get("ml", spec.key, default={}) or {}
        candidate = CandidateResult(spec.key, spec.display_name, spec.key == zoo.BASELINE_MODEL)
        try:
            model = zoo.build(spec.key, params, seed=seed, class_weight=class_weight)
            model.fit(X_train, y_train)
            if X_val.size:
                candidate.validation_metrics = evaluate_predictions(
                    y_val, zoo.predict_proba(model, X_val)
                )
            else:
                candidate.validation_metrics = {"warning": "no validation partition available"}
            candidate.cv_metrics = _cross_validate(
                spec.key, params, X_train, y_train,
                folds=folds, seed=seed, class_weight=class_weight,
            )
        except Exception as exc:
            candidate.error = f"{type(exc).__name__}: {exc}"
            log.warning("%s: %s failed to train (%s)", ds.pathogen_key, spec.key, candidate.error)
        result.candidates.append(candidate)

    usable = [c for c in result.candidates if c.error is None]
    if not usable:
        result.trained = False
        result.reason = "every candidate model failed to train"
        return result

    # ---- stage 2: select on VALIDATION ----
    def selection_key(c: CandidateResult) -> tuple:
        source = c.validation_metrics or {}
        # Compare on the prevalence-adjusted metric where one exists, so a model
        # is not rewarded for an easy (highly imbalanced) validation partition.
        primary_value, _ = registry.comparison_metric(source, primary)
        # CV mean is the fallback when the validation partition is too small to
        # produce a defined ranking metric.
        if primary_value is None:
            cv = (c.cv_metrics or {}).get(primary)
            primary_value = cv.get("mean") if isinstance(cv, dict) else None
        values = [primary_value if primary_value is not None else -1.0]
        for tb in tie_breakers:
            v = source.get(tb)
            values.append(v if v is not None else -1.0)
        return tuple(values)

    best = max(usable, key=selection_key)
    best.selected = True

    # ---- stage 3: refit on TRAIN+VALIDATION, score ONCE on TEST ----
    lib_versions = registry.library_versions()
    for candidate in usable:
        params = cfg.get("ml", candidate.model_key, default={}) or {}
        try:
            model = zoo.build(candidate.model_key, params, seed=seed, class_weight=class_weight)
            model.fit(X_fit_final, y_fit_final)
            probs = zoo.predict_proba(model, X_test)
            candidate.test_metrics = evaluate_predictions(y_test, probs)
            # Curves are stored once, at training time, so the dashboard can
            # draw them without ever recomputing a prediction. They are thinned
            # first: a thousand-point ROC curve is indistinguishable from a
            # two-hundred-point one on screen.
            raw_curves = curve_points(y_test, probs)
            candidate.test_metrics["curves"] = {
                "roc": downsample_curve(raw_curves.get("roc")),
                "pr": downsample_curve(raw_curves.get("pr")),
            }
            candidate.test_metrics["calibration"] = calibration_bins(y_test, probs)

            version = registry.next_model_version(conn, candidate.model_key, ds.pathogen_key)
            artifact = models_dir / f"{version}.joblib"
            joblib.dump(
                {
                    "model": model,
                    "model_version": version,
                    "model_type": candidate.model_key,
                    "pathogen_key": ds.pathogen_key,
                    "dataset_version": dataset_version,
                    "feature_version": feature_version,
                    "n_features": int(X.shape[1]),
                    "trained_at": utcnow(),
                    "library_versions": lib_versions,
                },
                artifact,
            )
            candidate.model_version = version
            # Prefer a project-relative path for readability, but never fail a
            # training run over a display detail (models_dir may be elsewhere).
            try:
                candidate.artifact_path = str(artifact.relative_to(PROJECT_ROOT))
            except ValueError:
                candidate.artifact_path = str(artifact)

            registry.register_model(
                conn,
                model_version=version,
                pathogen_key=ds.pathogen_key,
                model_type=candidate.model_key,
                is_baseline=candidate.is_baseline,
                dataset_version=dataset_version,
                feature_version=feature_version,
                validation_method=f"scaffold split + {folds}-fold CV on train",
                split_method=split.method,
                random_seed=seed,
                n_train=int(split.train_idx.size),
                n_validation=int(split.val_idx.size),
                n_test=int(split.test_idx.size),
                metrics={k: v for k, v in candidate.test_metrics.items() if k not in {"curves", "calibration"}},
                cv_metrics={"cv": candidate.cv_metrics, "validation": candidate.validation_metrics},
                selection_reason="benchmark candidate",
                artifact_path=str(artifact),
                status=registry.STATE_CANDIDATE,
                library_versions=lib_versions,
                curves={
                    "test": candidate.test_metrics.get("curves"),
                    "calibration": candidate.test_metrics.get("calibration"),
                },
            )
        except Exception as exc:
            candidate.error = f"final refit failed: {type(exc).__name__}: {exc}"
            log.warning("%s: %s", ds.pathogen_key, candidate.error)

    # Persist the comparison table rows.
    for candidate in result.candidates:
        conn.execute(
            """INSERT INTO model_benchmarks(benchmark_run_id, pathogen_key, model_type,
                   model_version, dataset_version, is_baseline, selected, metrics_json,
                   cv_metrics_json, created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                result.benchmark_run_id, ds.pathogen_key, candidate.model_key,
                candidate.model_version, dataset_version, int(candidate.is_baseline),
                int(candidate.selected),
                json.dumps(
                    {
                        "test": summarize_for_table(candidate.test_metrics),
                        "validation": summarize_for_table(candidate.validation_metrics),
                        "error": candidate.error,
                    },
                    default=str,
                ),
                json.dumps(candidate.cv_metrics, default=str),
                utcnow(),
            ),
        )
    conn.commit()

    if best.model_version is None:
        result.trained = False
        result.reason = f"selected model {best.model_key} could not be persisted: {best.error}"
        return result

    result.selected_model_version = best.model_version

    # ---- stage 4: promotion against the incumbent ----
    incumbent = registry.get_active_model(conn, ds.pathogen_key)
    decision = registry.evaluate_promotion(cfg, best.test_metrics, incumbent)
    selection_note = (
        f"selected on validation {primary}; "
        f"test {primary}="
        f"{best.test_metrics.get(primary) if best.test_metrics.get(primary) is not None else 'n/a'}; "
        f"{decision.reason}"
    )

    if decision.promote:
        registry.promote(conn, best.model_version, ds.pathogen_key, selection_note)
        result.promoted = True
    else:
        registry.set_status(conn, best.model_version, registry.STATE_CANDIDATE, selection_note)
    result.promotion_reason = decision.reason

    # Non-selected candidates stay as CANDIDATE unless they failed the floors.
    for candidate in usable:
        if candidate.model_version and candidate.model_version != best.model_version:
            registry.set_status(
                conn, candidate.model_version, registry.STATE_CANDIDATE,
                "benchmarked but not selected",
            )

    log.info(
        "%s: selected %s (%s), promoted=%s",
        ds.pathogen_key, best.model_version, best.display_name, result.promoted,
    )
    return result
