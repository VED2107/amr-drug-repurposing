"""Candidate ranking.

The composite score is an explicit, configurable weighted sum of normalised
evidence components. It exists to order a worklist, not to measure efficacy.
Every component is also returned separately so the dashboard can show the
evidence rather than hiding it behind one number.
"""

from __future__ import annotations

import sqlite3
from typing import Any

import pandas as pd

from ..config import Config

#: The only vocabulary this project uses for a highly ranked compound. There is
#: no "best drug", no "winner" and no "confirmed treatment".
CANDIDATE_LANGUAGE = {
    "label": "Prioritised candidate",
    "qualifier": "computationally promising; requires experimental validation",
    "disclaimer": (
        "Model probabilities and docking scores are computational predictions. "
        "They are not evidence of clinical efficacy or safety."
    ),
}


def _normalise_docking(score: float | None, best: float, worst: float) -> float | None:
    """Map a Vina score (more negative is better) onto 0..1."""
    if score is None:
        return None
    if worst == best:
        return None
    value = (worst - score) / (worst - best)
    return float(min(1.0, max(0.0, value)))


def _normalise_drug_likeness(lipinski_violations: int | None) -> float | None:
    """0 violations -> 1.0, 4 violations -> 0.0."""
    if lipinski_violations is None:
        return None
    return float(max(0.0, 1.0 - (int(lipinski_violations) / 4.0)))


def _normalise_clinical(n_trials: int | None) -> float | None:
    """Presence of human clinical history, saturating quickly.

    This measures only that the compound has been given to humans in a
    registered study - it says nothing about antimicrobial efficacy.
    """
    if n_trials is None:
        return None
    if n_trials <= 0:
        return 0.0
    if n_trials >= 5:
        return 1.0
    return float(n_trials / 5.0)


def score_components(
    *,
    ml_probability: float | None,
    docking_score: float | None,
    lipinski_violations: int | None,
    n_clinical_trials: int | None,
    cfg: Config,
) -> dict[str, float | None]:
    """Normalise each evidence stream to 0..1 (None when the evidence is absent)."""
    norm = cfg.get("ranking", "docking_normalisation", default={}) or {}
    return {
        "ml_probability": float(ml_probability) if ml_probability is not None else None,
        "docking": _normalise_docking(
            docking_score,
            float(norm.get("best_kcal_mol", -12.0)),
            float(norm.get("worst_kcal_mol", -4.0)),
        ),
        "drug_likeness": _normalise_drug_likeness(lipinski_violations),
        "clinical_history": _normalise_clinical(n_clinical_trials),
    }


def composite_score(components: dict[str, float | None], cfg: Config) -> dict[str, Any]:
    """Weighted sum over the components that are actually available.

    Weights are renormalised over the present components so a compound is not
    penalised merely for not having been docked yet. The returned dict records
    which components contributed, and their total weight, so a score built from
    one weak signal is visibly distinguishable from a complete one.
    """
    weights: dict[str, float] = dict(cfg.get("ranking", "weights", default={}) or {})
    used = {k: v for k, v in components.items() if v is not None and weights.get(k)}

    if not used:
        return {
            "score": None,
            "components_used": [],
            "evidence_weight": 0.0,
            "formula": "no evidence available",
        }

    total_weight = sum(weights[k] for k in used)
    score = sum(weights[k] * v for k, v in used.items()) / total_weight
    formula = " + ".join(f"{weights[k]:.2f}*{k}" for k in sorted(used)) + f"  / {total_weight:.2f}"

    return {
        "score": float(score),
        "components_used": sorted(used),
        # Fraction of the configured evidence that was actually available.
        "evidence_weight": float(total_weight / sum(weights.values())) if weights else 0.0,
        "formula": formula,
    }


def rank_candidates(
    conn: sqlite3.Connection,
    cfg: Config,
    pathogen_key: str,
    *,
    min_probability: float | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    """Assemble the evidence table for one pathogen, ordered by composite score.

    Every evidence stream is joined in independently; a missing stream leaves a
    null rather than a zero, so "not docked" never looks like "docked badly".
    """
    threshold = (
        float(min_probability)
        if min_probability is not None
        else float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
    )
    cap = limit or int(cfg.get("screening", "max_candidates_per_pathogen", default=200))

    rows = conn.execute(
        """
        SELECT
            p.molecule_id,
            p.probability                AS ml_probability,
            p.model_version,
            p.model_type,
            p.dataset_version,
            p.predicted_at,
            m.canonical_smiles,
            m.inchikey,
            m.pref_name,
            m.chembl_id,
            m.mw, m.logp, m.tpsa, m.hbd, m.hba, m.rotatable_bonds,
            m.lipinski_violations, m.qed,
            d.generic_name,
            d.brand_name,
            d.approval_source,
            d.marketing_status,
            dk.best_score                AS docking_score,
            dk.target_key                AS docking_target,
            ct.n_trials                  AS n_clinical_trials,
            ct.n_amr                     AS n_amr_trials
        FROM predictions p
        JOIN molecules m ON m.molecule_id = p.molecule_id
        LEFT JOIN (
            SELECT molecule_id,
                   MIN(generic_name) AS generic_name,
                   MIN(brand_name)   AS brand_name,
                   MIN(approval_source) AS approval_source,
                   MIN(marketing_status) AS marketing_status
            FROM drugs GROUP BY molecule_id
        ) d ON d.molecule_id = p.molecule_id
        LEFT JOIN (
            SELECT molecule_id, pathogen_key, MIN(score_kcal_mol) AS best_score,
                   MIN(target_key) AS target_key
            FROM docking_results
            WHERE status = 'ok' AND pose_rank = 1
            GROUP BY molecule_id, pathogen_key
        ) dk ON dk.molecule_id = p.molecule_id AND dk.pathogen_key = p.pathogen_key
        LEFT JOIN (
            SELECT molecule_id, n_results AS n_trials, n_amr FROM clinical_queries
        ) ct ON ct.molecule_id = p.molecule_id
        WHERE p.pathogen_key = ?
          AND p.probability >= ?
          AND p.model_version = (
              SELECT model_version FROM model_versions
              WHERE pathogen_key = ? AND status = 'ACTIVE'
              ORDER BY training_date DESC LIMIT 1
          )
        ORDER BY p.probability DESC
        LIMIT ?
        """,
        (pathogen_key, threshold, pathogen_key, cap),
    ).fetchall()

    if not rows:
        return pd.DataFrame(
            columns=[
                "molecule_id", "display_name", "ml_probability", "docking_score",
                "n_clinical_trials", "n_amr_trials", "lipinski_violations",
                "composite_score", "evidence_weight", "components_used",
                "model_version", "canonical_smiles",
            ]
        )

    records: list[dict[str, Any]] = []
    for row in rows:
        data = dict(row)
        components = score_components(
            ml_probability=data.get("ml_probability"),
            docking_score=data.get("docking_score"),
            lipinski_violations=data.get("lipinski_violations"),
            n_clinical_trials=data.get("n_clinical_trials"),
            cfg=cfg,
        )
        composite = composite_score(components, cfg)
        data["display_name"] = (
            data.get("generic_name") or data.get("pref_name") or data.get("molecule_id")
        )
        data["composite_score"] = composite["score"]
        data["evidence_weight"] = composite["evidence_weight"]
        data["components_used"] = ", ".join(composite["components_used"])
        data["score_formula"] = composite["formula"]
        records.append(data)

    df = pd.DataFrame(records)
    if cfg.get("ranking", "enabled", default=True) and "composite_score" in df:
        df = df.sort_values(
            ["composite_score", "ml_probability"], ascending=[False, False], na_position="last"
        ).reset_index(drop=True)
    df.insert(0, "rank", range(1, len(df) + 1))
    return df
