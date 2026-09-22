"""Model registry: versions, states and promotion rules.

States
------
CANDIDATE  trained and evaluated, not serving predictions
ACTIVE     the model currently used for screening (one per pathogen)
ARCHIVED   was active, superseded by a better model
REJECTED   failed the acceptance criteria and will not be promoted

Promotion is deliberately conservative: a challenger must beat the incumbent on
the primary metric by a configured margin AND clear absolute quality floors.
A worse model never replaces a good one.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from ..config import Config
from ..db import utcnow
from ..logging_utils import get_logger

log = get_logger("amr.registry")

STATE_CANDIDATE = "CANDIDATE"
STATE_ACTIVE = "ACTIVE"
STATE_ARCHIVED = "ARCHIVED"
STATE_REJECTED = "REJECTED"


@dataclass
class PromotionDecision:
    """The outcome of comparing a challenger with the incumbent."""

    promote: bool
    reason: str
    incumbent_version: str | None = None
    challenger_metric: float | None = None
    incumbent_metric: float | None = None


def next_model_version(conn: sqlite3.Connection, model_type: str, pathogen_key: str) -> str:
    """Produce the next version id, e.g. RF-mrsa-v3."""
    abbrev = {
        "random_forest": "RF",
        "extra_trees": "ET",
        "hist_gradient_boosting": "HGB",
        "logistic_regression": "LR",
        "linear_svm": "SVM",
        "xgboost": "XGB",
        "lightgbm": "LGBM",
    }.get(model_type, model_type[:4].upper())

    row = conn.execute(
        "SELECT COUNT(*) AS n FROM model_versions WHERE model_type = ? AND pathogen_key = ?",
        (model_type, pathogen_key),
    ).fetchone()
    return f"{abbrev}-{pathogen_key}-v{int(row['n'] or 0) + 1}"


def register_model(
    conn: sqlite3.Connection,
    *,
    model_version: str,
    pathogen_key: str,
    model_type: str,
    is_baseline: bool,
    dataset_version: str,
    feature_version: str,
    validation_method: str,
    split_method: str,
    random_seed: int,
    n_train: int,
    n_validation: int,
    n_test: int,
    metrics: dict[str, Any],
    cv_metrics: dict[str, Any] | None,
    selection_reason: str,
    artifact_path: str | None,
    status: str,
    library_versions: dict[str, str],
    curves: dict[str, Any] | None = None,
) -> None:
    """Insert one model version row."""
    conn.execute(
        """INSERT INTO model_versions(
               model_version, pathogen_key, model_type, is_baseline, dataset_version,
               feature_version, training_date, validation_method, split_method,
               random_seed, n_train, n_validation, n_test, metrics_json,
               cv_metrics_json, curves_json, selection_reason, artifact_path, status,
               library_versions, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            model_version, pathogen_key, model_type, int(is_baseline), dataset_version,
            feature_version, utcnow(), validation_method, split_method, random_seed,
            n_train, n_validation, n_test, json.dumps(metrics, default=str),
            json.dumps(cv_metrics, default=str) if cv_metrics else None,
            json.dumps(curves, default=str) if curves else None,
            selection_reason, artifact_path, status,
            json.dumps(library_versions, default=str), utcnow(),
        ),
    )


def get_active_model(conn: sqlite3.Connection, pathogen_key: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM model_versions WHERE pathogen_key = ? AND status = ? "
        "ORDER BY training_date DESC LIMIT 1",
        (pathogen_key, STATE_ACTIVE),
    ).fetchone()


def get_baseline_model(conn: sqlite3.Connection, pathogen_key: str) -> sqlite3.Row | None:
    """The most recent Random Forest baseline, whatever its current state."""
    return conn.execute(
        "SELECT * FROM model_versions WHERE pathogen_key = ? AND is_baseline = 1 "
        "ORDER BY training_date DESC LIMIT 1",
        (pathogen_key,),
    ).fetchone()


def _metric(metrics: dict[str, Any] | None, name: str) -> float | None:
    if not metrics:
        return None
    value = metrics.get(name)
    return float(value) if isinstance(value, (int, float)) else None


def comparison_metric(metrics: dict[str, Any] | None, primary: str) -> tuple[float | None, str]:
    """The value two models are actually compared on, and its name.

    PR-AUC is bounded below by the class prevalence, so comparing raw PR-AUC
    across dataset versions with different class balance is invalid: a model
    scoring 0.994 on a 98.5%-positive test set is barely better than random,
    while 0.994 on a 75%-positive set is genuinely strong. When the normalised
    form is available it is used instead, and the same applies to the
    acceptance floors.
    """
    if primary == "pr_auc":
        normalized = _metric(metrics, "pr_auc_normalized")
        if normalized is None:
            # Records written before the adjusted metric existed still carry the
            # two numbers it is derived from, so both sides of a comparison are
            # always expressed on the same scale.
            raw = _metric(metrics, "pr_auc")
            prevalence = _metric(metrics, "positive_prevalence")
            if raw is not None and prevalence is not None and prevalence < 1.0:
                normalized = (raw - prevalence) / (1.0 - prevalence)
        if normalized is not None:
            return normalized, "prevalence-adjusted PR-AUC"
    return _metric(metrics, primary), primary


def evaluate_promotion(
    cfg: Config,
    challenger_metrics: dict[str, Any],
    incumbent: sqlite3.Row | None,
) -> PromotionDecision:
    """Decide whether the challenger should become the ACTIVE model."""
    sel = cfg.get("ml", "selection", default={}) or {}
    primary = sel.get("primary_metric", "pr_auc")
    margin = float(sel.get("promotion_margin", 0.01))
    min_pr = sel.get("min_acceptable_pr_auc")
    min_roc = sel.get("min_acceptable_roc_auc")

    challenger_value, metric_name = comparison_metric(challenger_metrics, primary)
    if challenger_value is None:
        return PromotionDecision(False, f"challenger has no usable {primary} (evaluation undefined)")

    # Absolute floors first. A model below them is not fit to screen with,
    # regardless of whether it beats a worse incumbent.
    if min_pr is not None and primary == "pr_auc":
        if challenger_value < float(min_pr):
            prevalence = _metric(challenger_metrics, "positive_prevalence")
            detail = f" (raw PR-AUC {_metric(challenger_metrics, 'pr_auc'):.3f} against a " \
                     f"{prevalence:.1%} positive test set)" if prevalence is not None else ""
            return PromotionDecision(
                False,
                f"{metric_name} {challenger_value:.3f} is below the acceptance floor "
                f"{float(min_pr):.3f}{detail}",
                challenger_metric=challenger_value,
            )
    if min_roc is not None:
        roc = _metric(challenger_metrics, "roc_auc")
        if roc is not None and roc < float(min_roc):
            return PromotionDecision(
                False, f"ROC-AUC {roc:.3f} is below the acceptance floor {float(min_roc):.3f}",
                challenger_metric=challenger_value,
            )

    if incumbent is None:
        return PromotionDecision(
            True,
            f"no active model for this pathogen; promoting on {metric_name}={challenger_value:.3f}",
            challenger_metric=challenger_value,
        )

    try:
        incumbent_metrics = json.loads(incumbent["metrics_json"] or "{}")
    except (json.JSONDecodeError, TypeError):
        incumbent_metrics = {}
    incumbent_value, _ = comparison_metric(incumbent_metrics, primary)

    if incumbent_value is None:
        return PromotionDecision(
            True,
            f"incumbent {incumbent['model_version']} has no comparable {metric_name}; "
            "promoting challenger",
            incumbent_version=incumbent["model_version"], challenger_metric=challenger_value,
        )

    if challenger_value >= incumbent_value + margin:
        return PromotionDecision(
            True,
            f"{metric_name} improved {incumbent_value:.3f} -> {challenger_value:.3f} "
            f"(margin {margin:.3f} cleared)",
            incumbent_version=incumbent["model_version"],
            challenger_metric=challenger_value,
            incumbent_metric=incumbent_value,
        )

    return PromotionDecision(
        False,
        f"{metric_name} {challenger_value:.3f} does not beat incumbent {incumbent_value:.3f} "
        f"by the required margin {margin:.3f}; keeping {incumbent['model_version']} active",
        incumbent_version=incumbent["model_version"],
        challenger_metric=challenger_value,
        incumbent_metric=incumbent_value,
    )


def promote(conn: sqlite3.Connection, model_version: str, pathogen_key: str, reason: str) -> None:
    """Make one model ACTIVE, archiving whatever held that slot."""
    conn.execute(
        "UPDATE model_versions SET status = ? WHERE pathogen_key = ? AND status = ?",
        (STATE_ARCHIVED, pathogen_key, STATE_ACTIVE),
    )
    conn.execute(
        "UPDATE model_versions SET status = ?, selection_reason = ? WHERE model_version = ?",
        (STATE_ACTIVE, reason, model_version),
    )
    conn.commit()
    log.info("promoted %s to ACTIVE for %s: %s", model_version, pathogen_key, reason)


def reject(conn: sqlite3.Connection, model_version: str, reason: str) -> None:
    conn.execute(
        "UPDATE model_versions SET status = ?, selection_reason = ? WHERE model_version = ?",
        (STATE_REJECTED, reason, model_version),
    )
    conn.commit()
    log.info("model %s rejected: %s", model_version, reason)


def set_status(conn: sqlite3.Connection, model_version: str, status: str, reason: str = "") -> None:
    conn.execute(
        "UPDATE model_versions SET status = ?, selection_reason = COALESCE(NULLIF(?, ''), selection_reason) "
        "WHERE model_version = ?",
        (status, reason, model_version),
    )
    conn.commit()


def library_versions() -> dict[str, str]:
    """Record the library versions a model was trained with, for reproducibility."""
    import platform

    import numpy
    import sklearn
    import rdkit

    return {
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "scikit-learn": sklearn.__version__,
        "rdkit": rdkit.__version__,
        "platform": platform.platform(),
    }
