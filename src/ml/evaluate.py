"""Model evaluation.

Accuracy alone is meaningless on imbalanced bioactivity data - a model that
calls everything inactive can score 0.9. Every model is therefore reported with
threshold-free ranking metrics (ROC-AUC, PR-AUC), threshold metrics at 0.5, the
confusion matrix, sensitivity/specificity and a calibration summary.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)


def _safe(fn, default=None):
    try:
        value = fn()
    except Exception:
        return default
    if value is None:
        return default
    try:
        if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
            return default
    except Exception:
        pass
    return value


def evaluate_predictions(
    y_true: np.ndarray, y_prob: np.ndarray, *, threshold: float = 0.5
) -> dict[str, Any]:
    """Compute the full metric set for one set of predictions.

    Metrics that are undefined for the given data (ROC-AUC on a single-class
    set, for example) come back as None rather than as a fabricated number.
    """
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)

    if y_true.size == 0:
        return {"n": 0, "error": "empty evaluation set"}

    y_pred = (y_prob >= threshold).astype(int)
    classes = set(np.unique(y_true).tolist())
    single_class = len(classes) < 2

    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn_, tp = (int(x) for x in cm.ravel())

    sensitivity = tp / (tp + fn_) if (tp + fn_) else None
    specificity = tn / (tn + fp) if (tn + fp) else None

    # Positive rate at the operating threshold, useful for spotting a model
    # that has collapsed to predicting a single class.
    positive_rate = float(np.mean(y_pred)) if y_pred.size else None

    prevalence = float(y_true.mean())
    pr_auc = None if single_class else _safe(lambda: float(average_precision_score(y_true, y_prob)))

    # PR-AUC is bounded below by the class prevalence: a random ranker scores
    # exactly the prevalence. Raw PR-AUC is therefore NOT comparable between
    # datasets with different class balance - a 0.99 PR-AUC on a 98%-positive
    # set is worthless, while 0.90 on a 50%-positive set is strong. The
    # normalised form rescales the achievable range to 0..1 and is what model
    # selection compares.
    pr_auc_normalized = None
    if pr_auc is not None and prevalence < 1.0:
        pr_auc_normalized = float((pr_auc - prevalence) / (1.0 - prevalence))

    metrics: dict[str, Any] = {
        "n": int(y_true.size),
        "n_positive": int(y_true.sum()),
        "n_negative": int(y_true.size - y_true.sum()),
        "positive_prevalence": prevalence,
        "threshold": threshold,
        "roc_auc": None if single_class else _safe(lambda: float(roc_auc_score(y_true, y_prob))),
        "pr_auc": pr_auc,
        "pr_auc_normalized": pr_auc_normalized,
        "pr_auc_baseline": prevalence,
        "accuracy": _safe(lambda: float(accuracy_score(y_true, y_pred))),
        "balanced_accuracy": _safe(lambda: float(balanced_accuracy_score(y_true, y_pred))),
        "precision": _safe(lambda: float(precision_score(y_true, y_pred, zero_division=0))),
        "recall": _safe(lambda: float(recall_score(y_true, y_pred, zero_division=0))),
        "f1": _safe(lambda: float(f1_score(y_true, y_pred, zero_division=0))),
        "mcc": _safe(lambda: float(matthews_corrcoef(y_true, y_pred))),
        "sensitivity": sensitivity,
        "specificity": specificity,
        "predicted_positive_rate": positive_rate,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn_, "tp": tp},
        "brier_score": _safe(lambda: float(brier_score_loss(y_true, y_prob))),
        "single_class_evaluation_set": single_class,
    }

    if single_class:
        metrics["warning"] = (
            "evaluation set contains a single class; ranking metrics are undefined"
        )
    return metrics


def curve_points(y_true: np.ndarray, y_prob: np.ndarray) -> dict[str, Any]:
    """ROC and precision-recall curve points for the dashboard charts."""
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)
    if y_true.size == 0 or len(set(y_true.tolist())) < 2:
        return {"roc": None, "pr": None}

    fpr, tpr, roc_thresh = roc_curve(y_true, y_prob)
    precision, recall, pr_thresh = precision_recall_curve(y_true, y_prob)
    return {
        "roc": {
            "fpr": [float(x) for x in fpr],
            "tpr": [float(x) for x in tpr],
            "thresholds": [float(x) for x in roc_thresh],
        },
        "pr": {
            "precision": [float(x) for x in precision],
            "recall": [float(x) for x in recall],
            "thresholds": [float(x) for x in pr_thresh],
        },
    }


def downsample_curve(curve: dict[str, Any] | None, max_points: int = 200) -> dict[str, Any] | None:
    """Thin a curve to at most ``max_points`` so it can be stored cheaply.

    The first and last points are always kept, so the curve still spans its full
    range and the plotted shape is unchanged at display resolution.
    """
    if not curve:
        return None
    out: dict[str, Any] = {}
    for key, values in curve.items():
        if not isinstance(values, list) or len(values) <= max_points:
            out[key] = values
            continue
        step = len(values) / float(max_points)
        indices = sorted({int(i * step) for i in range(max_points)} | {len(values) - 1})
        out[key] = [values[i] for i in indices]
    return out


def calibration_bins(
    y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10
) -> list[dict[str, float]]:
    """Reliability-diagram bins: predicted probability vs observed frequency."""
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)
    if y_true.size == 0:
        return []

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    out: list[dict[str, float]] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (y_prob >= lo) & (y_prob < hi if hi < 1.0 else y_prob <= hi)
        if not mask.any():
            continue
        out.append(
            {
                "bin_lower": float(lo),
                "bin_upper": float(hi),
                "mean_predicted": float(y_prob[mask].mean()),
                "observed_frequency": float(y_true[mask].mean()),
                "count": int(mask.sum()),
            }
        )
    return out


def ensure_normalized(metrics: dict[str, Any] | None) -> dict[str, Any]:
    """Derive ``pr_auc_normalized`` when it is absent but derivable.

    Model records written before the adjusted metric existed still carry the
    two numbers it comes from. Deriving it on read keeps every model on one
    scale without rewriting stored evaluations.
    """
    if not metrics:
        return {}
    out = dict(metrics)
    if out.get("pr_auc_normalized") is None:
        pr_auc = out.get("pr_auc")
        prevalence = out.get("positive_prevalence")
        if isinstance(pr_auc, (int, float)) and isinstance(prevalence, (int, float)) and prevalence < 1.0:
            out["pr_auc_normalized"] = float((pr_auc - prevalence) / (1.0 - prevalence))
            out["pr_auc_baseline"] = float(prevalence)
    return out


def summarize_for_table(metrics: dict[str, Any]) -> dict[str, Any]:
    """The subset of metrics shown in the model comparison table."""
    keys = [
        "roc_auc", "pr_auc", "pr_auc_normalized", "pr_auc_baseline",
        "f1", "precision", "recall", "balanced_accuracy", "mcc", "positive_prevalence",
    ]
    return {k: metrics.get(k) for k in keys}
