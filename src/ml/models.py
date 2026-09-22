"""The model zoo.

Random Forest is the baseline fixed by the project presentation. The
alternatives here are the classical supervised models that are appropriate for
sparse binary molecular fingerprints on datasets of a few hundred to a few tens
of thousands of rows. Deep learning and graph networks are deliberately absent:
they are not justified at this dataset size, and adding them to look
sophisticated would be the opposite of good practice.

Optional gradient boosting libraries (XGBoost, LightGBM) are registered only
when they are actually installed, so the benchmark table never lists a model
that was not really trained.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import (
    ExtraTreesClassifier,
    HistGradientBoostingClassifier,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC

BASELINE_MODEL = "random_forest"


@dataclass(frozen=True)
class ModelSpec:
    """A benchmarkable model: how to build it and what it needs to run."""

    key: str
    display_name: str
    builder: Callable[[dict[str, Any], int, str | None], Any]
    #: Boosting models overfit badly on very small datasets, so they are only
    #: offered above a configured row count.
    requires_large_dataset: bool = False
    notes: str = ""


def _random_forest(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    return RandomForestClassifier(
        n_estimators=int(params.get("n_estimators", 500)),
        max_depth=params.get("max_depth"),
        min_samples_leaf=int(params.get("min_samples_leaf", 1)),
        n_jobs=int(params.get("n_jobs", -1)),
        class_weight=class_weight,
        random_state=seed,
    )


def _extra_trees(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    return ExtraTreesClassifier(
        n_estimators=int(params.get("n_estimators", 500)),
        max_depth=params.get("max_depth"),
        min_samples_leaf=int(params.get("min_samples_leaf", 1)),
        n_jobs=int(params.get("n_jobs", -1)),
        class_weight=class_weight,
        random_state=seed,
    )


def _hist_gradient_boosting(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    return HistGradientBoostingClassifier(
        max_iter=int(params.get("max_iter", 300)),
        learning_rate=float(params.get("learning_rate", 0.08)),
        class_weight=class_weight,
        random_state=seed,
    )


def _logistic_regression(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    return LogisticRegression(
        C=float(params.get("C", 1.0)),
        max_iter=int(params.get("max_iter", 2000)),
        class_weight=class_weight,
        random_state=seed,
        solver="liblinear",
    )


def _linear_svm(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    # LinearSVC has no predict_proba; wrap it so every model in the zoo exposes
    # the same probability interface and the metrics stay comparable.
    base = LinearSVC(
        C=float(params.get("C", 1.0)),
        class_weight=class_weight,
        random_state=seed,
        dual="auto",
    )
    return CalibratedClassifierCV(base, method="sigmoid", cv=3)


def _xgboost(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    from xgboost import XGBClassifier  # imported lazily; optional dependency

    return XGBClassifier(
        n_estimators=int(params.get("n_estimators", 400)),
        learning_rate=float(params.get("learning_rate", 0.08)),
        max_depth=int(params.get("max_depth", 6)),
        subsample=float(params.get("subsample", 0.9)),
        colsample_bytree=float(params.get("colsample_bytree", 0.8)),
        eval_metric="logloss",
        random_state=seed,
        n_jobs=-1,
        tree_method="hist",
    )


def _lightgbm(params: dict[str, Any], seed: int, class_weight: str | None) -> Any:
    from lightgbm import LGBMClassifier  # imported lazily; optional dependency

    return LGBMClassifier(
        n_estimators=int(params.get("n_estimators", 400)),
        learning_rate=float(params.get("learning_rate", 0.08)),
        num_leaves=int(params.get("num_leaves", 31)),
        class_weight=class_weight,
        random_state=seed,
        n_jobs=-1,
        verbose=-1,
    )


_ALL_SPECS: dict[str, ModelSpec] = {
    "random_forest": ModelSpec(
        "random_forest", "Random Forest", _random_forest,
        notes="project baseline; robust on sparse fingerprints",
    ),
    "extra_trees": ModelSpec(
        "extra_trees", "Extra Trees", _extra_trees,
        notes="randomised splits, lower variance than RF on small data",
    ),
    "hist_gradient_boosting": ModelSpec(
        "hist_gradient_boosting", "HistGradientBoosting", _hist_gradient_boosting,
        requires_large_dataset=True,
        notes="boosting; needs enough rows to avoid overfitting",
    ),
    "logistic_regression": ModelSpec(
        "logistic_regression", "Logistic Regression", _logistic_regression,
        notes="linear baseline, naturally calibrated probabilities",
    ),
    "linear_svm": ModelSpec(
        "linear_svm", "Linear SVM (calibrated)", _linear_svm,
        notes="margin classifier; probabilities via Platt scaling",
    ),
    "xgboost": ModelSpec(
        "xgboost", "XGBoost", _xgboost, requires_large_dataset=True,
        notes="optional dependency",
    ),
    "lightgbm": ModelSpec(
        "lightgbm", "LightGBM", _lightgbm, requires_large_dataset=True,
        notes="optional dependency",
    ),
}


def is_available(key: str) -> bool:
    """True when the model can actually be constructed in this environment."""
    if key not in _ALL_SPECS:
        return False
    if key == "xgboost":
        try:
            import xgboost  # noqa: F401
        except Exception:
            return False
    if key == "lightgbm":
        try:
            import lightgbm  # noqa: F401
        except Exception:
            return False
    return True


def resolve_specs(
    requested: list[str], *, n_rows: int, min_rows_for_boosting: int
) -> tuple[list[ModelSpec], list[dict[str, str]]]:
    """Return the specs to benchmark plus a reason for every one skipped."""
    selected: list[ModelSpec] = []
    skipped: list[dict[str, str]] = []

    for key in requested:
        spec = _ALL_SPECS.get(key)
        if spec is None:
            skipped.append({"model": key, "reason": "unknown model key"})
            continue
        if not is_available(key):
            skipped.append({"model": key, "reason": "library not installed"})
            continue
        if spec.requires_large_dataset and n_rows < min_rows_for_boosting:
            skipped.append({
                "model": key,
                "reason": f"dataset has {n_rows} rows, below the {min_rows_for_boosting}-row "
                          "threshold for boosting models",
            })
            continue
        selected.append(spec)

    # The baseline must always be present: the project requires it.
    if not any(s.key == BASELINE_MODEL for s in selected) and is_available(BASELINE_MODEL):
        selected.insert(0, _ALL_SPECS[BASELINE_MODEL])

    return selected, skipped


def build(key: str, params: dict[str, Any], *, seed: int, class_weight: str | None) -> Any:
    """Instantiate one model."""
    spec = _ALL_SPECS.get(key)
    if spec is None:
        raise ValueError(f"unknown model key: {key}")
    return spec.builder(params or {}, seed, class_weight)


def display_name(key: str) -> str:
    spec = _ALL_SPECS.get(key)
    return spec.display_name if spec else key


def predict_proba(model: Any, X: np.ndarray) -> np.ndarray:
    """Positive-class probability for any model in the zoo."""
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)
        if proba.ndim == 2 and proba.shape[1] == 2:
            return proba[:, 1]
        if proba.ndim == 2 and proba.shape[1] == 1:
            # A model fitted on a single class; its one column is that class.
            only = int(getattr(model, "classes_", [0])[0])
            return proba[:, 0] if only == 1 else 1.0 - proba[:, 0]
        return proba.ravel()
    if hasattr(model, "decision_function"):
        scores = model.decision_function(X)
        return 1.0 / (1.0 + np.exp(-scores))
    raise TypeError(f"model {type(model).__name__} exposes neither predict_proba nor decision_function")


def feature_importance(model: Any, n_features: int) -> np.ndarray | None:
    """Per-bit importance where the model type supports it, else None.

    Importance over fingerprint bits indicates which substructures the model
    keys on. It does NOT establish a biological mechanism.
    """
    if hasattr(model, "feature_importances_"):
        imp = np.asarray(model.feature_importances_, dtype=float)
        return imp if imp.size == n_features else None
    if hasattr(model, "coef_"):
        coef = np.asarray(model.coef_, dtype=float).ravel()
        return np.abs(coef) if coef.size == n_features else None
    return None
