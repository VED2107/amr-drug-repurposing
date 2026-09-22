"""Screening approved drugs with the ACTIVE model.

A new drug is screened with the existing model. It never triggers retraining -
retraining is driven by new *labelled bioactivity data*, which is a different
event entirely (see :mod:`src.pipeline.train`).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import joblib
import numpy as np

from ..chemistry.fingerprints import fingerprint_from_blob
from ..config import Config
from ..db import utcnow
from ..logging_utils import get_logger
from . import models as zoo
from . import registry

log = get_logger("amr.predict")


@dataclass
class ScreeningResult:
    """Outcome of screening a library against one pathogen."""

    pathogen_key: str
    model_version: str | None
    n_scored: int = 0
    n_skipped: int = 0
    n_candidates: int = 0
    errors: list[str] = field(default_factory=list)
    skipped_reason: str = ""


class ModelCache:
    """Loads model artifacts once per process."""

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}

    def load(self, artifact_path: str | Path) -> dict[str, Any]:
        key = str(artifact_path)
        if key not in self._cache:
            path = Path(artifact_path)
            if not path.exists():
                raise FileNotFoundError(f"model artifact missing: {path}")
            self._cache[key] = joblib.load(path)
        return self._cache[key]


def _fetch_molecules(
    conn: sqlite3.Connection,
    *,
    only_unscored_for: str | None = None,
    model_version: str | None = None,
    approved_only: bool = True,
    limit: int | None = None,
) -> list[sqlite3.Row]:
    """Molecules eligible for screening.

    ``only_unscored_for`` restricts to molecules with no prediction yet for that
    pathogen under ``model_version`` - this is what makes incremental screening
    cheap: unchanged molecules are never re-scored.
    """
    sql = [
        "SELECT m.molecule_id, m.fingerprint FROM molecules m",
    ]
    where = ["m.is_valid = 1", "m.fingerprint IS NOT NULL"]
    params: list[Any] = []

    if approved_only:
        sql.append("JOIN drugs d ON d.molecule_id = m.molecule_id")

    if only_unscored_for and model_version:
        where.append(
            "NOT EXISTS (SELECT 1 FROM predictions p WHERE p.molecule_id = m.molecule_id "
            "AND p.pathogen_key = ? AND p.model_version = ?)"
        )
        params.extend([only_unscored_for, model_version])

    sql.append("WHERE " + " AND ".join(where))
    sql.append("GROUP BY m.molecule_id")
    if limit:
        sql.append("LIMIT ?")
        params.append(int(limit))

    return conn.execute(" ".join(sql), params).fetchall()


def screen_pathogen(
    conn: sqlite3.Connection,
    cfg: Config,
    pathogen_key: str,
    *,
    cache: ModelCache | None = None,
    incremental: bool = True,
    approved_only: bool = True,
    limit: int | None = None,
) -> ScreeningResult:
    """Score the approved-drug library against one pathogen."""
    cache = cache or ModelCache()
    active = registry.get_active_model(conn, pathogen_key)
    if active is None:
        return ScreeningResult(
            pathogen_key, None, skipped_reason="no ACTIVE model for this pathogen"
        )

    model_version = active["model_version"]
    try:
        bundle = cache.load(active["artifact_path"])
    except Exception as exc:
        return ScreeningResult(
            pathogen_key, model_version,
            skipped_reason=f"could not load model artifact: {exc}",
        )

    model = bundle["model"]
    n_bits = int(bundle.get("n_features", cfg.get("chemistry", "fingerprint", "n_bits", default=1024)))

    rows = _fetch_molecules(
        conn,
        only_unscored_for=pathogen_key if incremental else None,
        model_version=model_version if incremental else None,
        approved_only=approved_only,
        limit=limit,
    )

    result = ScreeningResult(pathogen_key, model_version)
    if not rows:
        result.skipped_reason = "no molecules needed scoring"
        return result

    molecule_ids: list[str] = []
    features: list[np.ndarray] = []
    for row in rows:
        try:
            features.append(fingerprint_from_blob(row["fingerprint"], n_bits))
            molecule_ids.append(row["molecule_id"])
        except Exception as exc:
            result.n_skipped += 1
            result.errors.append(f"{row['molecule_id']}: {exc}")

    if not features:
        result.skipped_reason = "no usable fingerprints"
        return result

    X = np.vstack(features).astype(np.float32)
    try:
        probabilities = zoo.predict_proba(model, X)
    except Exception as exc:
        result.skipped_reason = f"prediction failed: {type(exc).__name__}: {exc}"
        return result

    threshold = float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
    stamp = utcnow()
    payload = [
        (
            molecule_ids[i], pathogen_key, float(probabilities[i]), model_version,
            active["model_type"], active["dataset_version"], active["feature_version"], stamp, 0,
        )
        for i in range(len(molecule_ids))
    ]

    conn.executemany(
        """INSERT INTO predictions(molecule_id, pathogen_key, probability, model_version,
               model_type, dataset_version, feature_version, predicted_at, is_demo)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(molecule_id, pathogen_key, model_version)
           DO UPDATE SET probability = excluded.probability,
                         predicted_at = excluded.predicted_at""",
        payload,
    )
    conn.commit()

    result.n_scored = len(payload)
    result.n_candidates = int(np.sum(probabilities >= threshold))
    log.info(
        "%s: scored %d molecules with %s, %d above the %.2f candidate threshold",
        pathogen_key, result.n_scored, model_version, result.n_candidates, threshold,
    )
    return result


def predict_smiles(
    conn: sqlite3.Connection,
    cfg: Config,
    smiles: str,
    *,
    cache: ModelCache | None = None,
) -> dict[str, Any]:
    """Ad-hoc prediction for an arbitrary structure, for the dashboard.

    The result is returned, not stored: it is an exploratory query, not a
    pipeline record.
    """
    from ..chemistry import morgan_fingerprint, standardize_smiles

    std_cfg = cfg.get("chemistry", "standardization", default={}) or {}
    fp_cfg = cfg.get("chemistry", "fingerprint", default={}) or {}

    record = standardize_smiles(
        smiles,
        strip_salts=bool(std_cfg.get("strip_salts", True)),
        min_heavy_atoms=int(std_cfg.get("min_heavy_atoms", 5)),
        max_heavy_atoms=int(std_cfg.get("max_heavy_atoms", 150)),
    )
    if not record.is_valid:
        return {"ok": False, "error": record.error, "molecule_id": None, "predictions": {}}

    fp = morgan_fingerprint(
        record.mol,
        radius=int(fp_cfg.get("radius", 2)),
        n_bits=int(fp_cfg.get("n_bits", 1024)),
        use_chirality=bool(fp_cfg.get("use_chirality", False)),
    )
    X = fp.reshape(1, -1).astype(np.float32)

    cache = cache or ModelCache()
    predictions: dict[str, Any] = {}
    for pathogen in cfg.pathogens:
        active = registry.get_active_model(conn, pathogen.key)
        if active is None:
            predictions[pathogen.key] = {"available": False, "reason": "no active model"}
            continue
        try:
            bundle = cache.load(active["artifact_path"])
            prob = float(zoo.predict_proba(bundle["model"], X)[0])
            predictions[pathogen.key] = {
                "available": True,
                "probability": prob,
                "model_version": active["model_version"],
                "model_type": active["model_type"],
                "dataset_version": active["dataset_version"],
            }
        except Exception as exc:
            predictions[pathogen.key] = {"available": False, "reason": f"{type(exc).__name__}: {exc}"}

    return {
        "ok": True,
        "molecule_id": record.molecule_id,
        "canonical_smiles": record.canonical_smiles,
        "inchikey": record.inchikey,
        "predictions": predictions,
    }


def feature_importance_for(
    conn: sqlite3.Connection, pathogen_key: str, *, top_n: int = 25,
    cache: ModelCache | None = None,
) -> list[dict[str, Any]]:
    """Top fingerprint bits by model importance.

    Fingerprint-bit importance indicates which substructural patterns the model
    relies on. It does not establish a biological mechanism.
    """
    active = registry.get_active_model(conn, pathogen_key)
    if active is None:
        return []
    cache = cache or ModelCache()
    try:
        bundle = cache.load(active["artifact_path"])
    except Exception:
        return []

    n_features = int(bundle.get("n_features", 1024))
    importance = zoo.feature_importance(bundle["model"], n_features)
    if importance is None:
        return []

    order = np.argsort(importance)[::-1][:top_n]
    return [
        {"bit": int(i), "importance": float(importance[i])}
        for i in order
        if importance[i] > 0
    ]
