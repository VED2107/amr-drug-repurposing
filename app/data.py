"""Cached data access for the dashboard.

Opening the dashboard must never retrain a model, rerun docking or recompute
fingerprints. Every function here is a read against results the pipeline already
stored, wrapped in Streamlit's cache.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

from src.config import Config, load_config
from src.db import connect, init_db
from src.ml import registry
from src.ml.evaluate import ensure_normalized
from src.ranking import rank_candidates

CACHE_TTL = 120  # seconds; the pipeline writes infrequently


@st.cache_resource
def get_config() -> Config:
    return load_config()


def open_conn() -> sqlite3.Connection:
    """A fresh read connection. SQLite connections are not thread-safe, and
    Streamlit reruns can land on different threads, so this is never cached."""
    cfg = get_config()
    conn = connect(cfg)
    init_db(conn, cfg)
    return conn


def _df(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = open_conn()
    try:
        rows = conn.execute(sql, params).fetchall()
        cols = [d[0] for d in conn.execute(sql, params).description or []]
        return pd.DataFrame([dict(r) for r in rows], columns=cols or None)
    finally:
        conn.close()


#: Counting rows in ``predictions`` counts every model generation ever run.
#: Every figure shown to a reader is from the ACTIVE model, so every count of
#: them has to say so too.
_ACTIVE_PREDICTIONS_COUNT = (
    "SELECT {what} FROM predictions p "
    "JOIN model_versions mv ON mv.model_version = p.model_version AND mv.status = 'ACTIVE'"
)


def database_exists() -> bool:
    cfg = get_config()
    path: Path = cfg.db_path
    return path.exists() and path.stat().st_size > 0


# ------------------------------------------------------------------ counts --
@st.cache_data(ttl=CACHE_TTL)
def overview_counts() -> dict[str, Any]:
    conn = open_conn()
    try:
        def n(sql: str, params: tuple = ()) -> int:
            row = conn.execute(sql, params).fetchone()
            return int(row[0] or 0) if row else 0

        active_models = conn.execute(
            "SELECT pathogen_key, model_version, model_type FROM model_versions WHERE status='ACTIVE'"
        ).fetchall()

        return {
            "molecules_total": n("SELECT COUNT(*) FROM molecules"),
            "molecules_valid": n("SELECT COUNT(*) FROM molecules WHERE is_valid=1"),
            "molecules_invalid": n("SELECT COUNT(*) FROM molecules WHERE is_valid=0"),
            "approved_products": n("SELECT COUNT(*) FROM drugs"),
            "approved_with_structure": n("SELECT COUNT(DISTINCT molecule_id) FROM drugs WHERE molecule_id IS NOT NULL"),
            "bioactivity_total": n("SELECT COUNT(*) FROM bioactivity"),
            "bioactivity_labelled": n("SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL"),
            # Superseded predictions from archived models stay in the table for
            # provenance, but they are not what the interface shows, so they are
            # not counted here either.
            "screened_molecules": n(_ACTIVE_PREDICTIONS_COUNT.format(what="COUNT(DISTINCT p.molecule_id)")),
            "predictions_total": n(_ACTIVE_PREDICTIONS_COUNT.format(what="COUNT(*)")),
            "docking_runs": n("SELECT COUNT(*) FROM docking_runs"),
            "docking_results": n("SELECT COUNT(*) FROM docking_results WHERE status='ok' AND pose_rank=1"),
            "clinical_records": n("SELECT COUNT(*) FROM clinical_trials"),
            "clinical_queried": n("SELECT COUNT(*) FROM clinical_queries"),
            "active_models": [dict(r) for r in active_models],
            "demo_rows": n("SELECT COUNT(*) FROM predictions WHERE is_demo=1"),
        }
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def pathogen_summaries() -> list[dict[str, Any]]:
    cfg = get_config()
    conn = open_conn()
    try:
        threshold = float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
        out = []
        for p in cfg.pathogens:
            active = registry.get_active_model(conn, p.key)
            model_version = active["model_version"] if active else None

            row = conn.execute(
                """SELECT COUNT(*) AS screened, MAX(probability) AS best,
                          SUM(CASE WHEN probability >= ? THEN 1 ELSE 0 END) AS candidates
                   FROM predictions WHERE pathogen_key = ? AND model_version = COALESCE(?, model_version)""",
                (threshold, p.key, model_version),
            ).fetchone()

            dock = conn.execute(
                """SELECT COUNT(*) AS n, MIN(score_kcal_mol) AS best
                   FROM docking_results WHERE pathogen_key = ? AND status='ok' AND pose_rank = 1""",
                (p.key,),
            ).fetchone()

            labelled = conn.execute(
                """SELECT COUNT(*) AS n,
                          SUM(CASE WHEN label=1 THEN 1 ELSE 0 END) AS actives,
                          COALESCE(SUM(strain_specific), 0) AS resistant
                   FROM bioactivity WHERE pathogen_key = ? AND label IS NOT NULL""",
                (p.key,),
            ).fetchone()
            n_labelled = int(labelled["n"] or 0)
            n_resistant = int(labelled["resistant"] or 0)

            # Headline model quality, on the same scale the selector used.
            roc = adjusted = n_test = None
            if active is not None:
                try:
                    metrics = ensure_normalized(json.loads(active["metrics_json"] or "{}"))
                except (json.JSONDecodeError, TypeError):
                    metrics = {}
                roc = metrics.get("roc_auc")
                adjusted = metrics.get("pr_auc_normalized")
                n_test = active["n_test"]

            out.append(
                {
                    "key": p.key,
                    "label": p.label,
                    "full_name": p.full_name,
                    "organism": p.organism,
                    "roc_auc": roc,
                    "pr_auc_adjusted": adjusted,
                    "n_test": n_test,
                    "screened": int(row["screened"] or 0),
                    "candidates": int(row["candidates"] or 0),
                    "best_probability": float(row["best"]) if row["best"] is not None else None,
                    "docking_results": int(dock["n"] or 0),
                    "best_docking": float(dock["best"]) if dock["best"] is not None else None,
                    "labelled_records": n_labelled,
                    "labelled_actives": int(labelled["actives"] or 0),
                    "resistant_records": n_resistant,
                    "resistant_fraction": (n_resistant / n_labelled) if n_labelled else None,
                    "model_version": model_version,
                    "model_type": active["model_type"] if active else None,
                }
            )
        return out
    finally:
        conn.close()


# ------------------------------------------------------------- screening ----
@st.cache_data(ttl=CACHE_TTL)
def screening_table(
    pathogen: str | None = None,
    min_probability: float = 0.0,
    approved_only: bool = True,
    require_docking: bool = False,
    require_clinical: bool = False,
    search: str = "",
    limit: int = 500,
) -> pd.DataFrame:
    """The drug screening table with all filters applied in SQL."""
    where = ["p.probability >= ?"]
    params: list[Any] = [float(min_probability)]

    if pathogen:
        where.append("p.pathogen_key = ?")
        params.append(pathogen)
    if approved_only:
        where.append("d.molecule_id IS NOT NULL")
    if require_docking:
        where.append("dk.best_score IS NOT NULL")
    if require_clinical:
        where.append("COALESCE(ct.n_trials, 0) > 0")

    if search and search.strip():
        token = f"%{search.strip().lower()}%"
        where.append(
            "(LOWER(COALESCE(d.generic_name,'')) LIKE ? OR LOWER(COALESCE(d.brand_name,'')) LIKE ? "
            "OR LOWER(COALESCE(m.pref_name,'')) LIKE ? OR LOWER(COALESCE(m.chembl_id,'')) LIKE ? "
            "OR LOWER(COALESCE(m.inchikey,'')) LIKE ? OR LOWER(COALESCE(m.canonical_smiles,'')) LIKE ?)"
        )
        params.extend([token] * 6)

    sql = f"""
        SELECT
            p.molecule_id,
            COALESCE(d.generic_name, m.pref_name, p.molecule_id) AS drug,
            d.brand_name,
            p.pathogen_key AS pathogen,
            p.probability AS ml_probability,
            CASE WHEN d.molecule_id IS NOT NULL THEN d.approval_source ELSE 'Not FDA-matched' END AS approval,
            dk.best_score AS docking_score,
            COALESCE(ct.n_trials, 0) AS clinical_trials,
            COALESCE(ct.n_amr, 0) AS amr_related_trials,
            CASE WHEN ct.molecule_id IS NULL THEN 0 ELSE 1 END AS clinical_checked,
            m.mw, m.logp, m.lipinski_violations,
            m.chembl_id, m.inchikey, m.canonical_smiles,
            p.model_version, p.model_type, p.predicted_at
        FROM predictions p
        JOIN model_versions mv ON mv.model_version = p.model_version AND mv.status = 'ACTIVE'
        JOIN molecules m ON m.molecule_id = p.molecule_id
        LEFT JOIN (SELECT molecule_id, MIN(generic_name) AS generic_name,
                          MIN(brand_name) AS brand_name, MIN(approval_source) AS approval_source
                   FROM drugs WHERE molecule_id IS NOT NULL GROUP BY molecule_id) d
               ON d.molecule_id = p.molecule_id
        LEFT JOIN (SELECT molecule_id, pathogen_key, MIN(score_kcal_mol) AS best_score
                   FROM docking_results WHERE status='ok' AND pose_rank=1
                   GROUP BY molecule_id, pathogen_key) dk
               ON dk.molecule_id = p.molecule_id AND dk.pathogen_key = p.pathogen_key
        LEFT JOIN (SELECT molecule_id, n_results AS n_trials, n_amr FROM clinical_queries) ct
               ON ct.molecule_id = p.molecule_id
        WHERE {' AND '.join(where)}
        ORDER BY p.probability DESC
        LIMIT ?
    """
    params.append(int(limit))
    return _df(sql, tuple(params))


@st.cache_data(ttl=CACHE_TTL)
def candidates(pathogen: str, min_probability: float | None = None, limit: int = 200) -> pd.DataFrame:
    cfg = get_config()
    conn = open_conn()
    try:
        return rank_candidates(conn, cfg, pathogen, min_probability=min_probability, limit=limit)
    finally:
        conn.close()


# ----------------------------------------------------------- drug details ---
@st.cache_data(ttl=CACHE_TTL)
def molecule_detail(molecule_id: str) -> dict[str, Any]:
    conn = open_conn()
    try:
        mol = conn.execute("SELECT * FROM molecules WHERE molecule_id = ?", (molecule_id,)).fetchone()
        if mol is None:
            return {}
        drugs = conn.execute(
            "SELECT * FROM drugs WHERE molecule_id = ? ORDER BY generic_name LIMIT 50", (molecule_id,)
        ).fetchall()
        # Only the ACTIVE model's row per pathogen. A retrain leaves the previous
        # generation in the table, and showing both would give one medicine two
        # different probabilities for the same bacterium.
        preds = conn.execute(
            """SELECT p.*, mv.status AS model_status
               FROM predictions p
               JOIN model_versions mv ON mv.model_version = p.model_version
                                     AND mv.status = 'ACTIVE'
               WHERE p.molecule_id = ? ORDER BY p.pathogen_key""",
            (molecule_id,),
        ).fetchall()
        docking = conn.execute(
            """SELECT dr.*, t.name AS target_name, t.pdb_id
               FROM docking_results dr LEFT JOIN targets t ON t.target_key = dr.target_key
               WHERE dr.molecule_id = ? AND dr.pose_rank = 1 ORDER BY dr.score_kcal_mol""",
            (molecule_id,),
        ).fetchall()
        trials = conn.execute(
            "SELECT * FROM clinical_trials WHERE molecule_id = ? ORDER BY amr_related DESC, nct_id LIMIT 100",
            (molecule_id,),
        ).fetchall()
        query = conn.execute(
            "SELECT * FROM clinical_queries WHERE molecule_id = ?", (molecule_id,)
        ).fetchone()
        activity = conn.execute(
            """SELECT pathogen_key, activity_type, activity_relation, activity_value,
                      activity_units, pactivity, label, label_reason, assay_description,
                      document_chembl_id
               FROM bioactivity WHERE molecule_id = ? ORDER BY pathogen_key LIMIT 100""",
            (molecule_id,),
        ).fetchall()

        return {
            "molecule": dict(mol),
            "drugs": [dict(r) for r in drugs],
            "predictions": [dict(r) for r in preds],
            "docking": [dict(r) for r in docking],
            "trials": [dict(r) for r in trials],
            "clinical_query": dict(query) if query else None,
            "bioactivity": [dict(r) for r in activity],
        }
    finally:
        conn.close()


#: Keyword patterns that map a free-text condition onto a pathogen this system
#: actually models. Only for these does an AI probability exist; anything else
#: is answered with documented evidence, never an invented number.
AMR_DISEASE_PATTERNS: dict[str, tuple[str, ...]] = {
    "mrsa": ("mrsa", "methicillin-resistant", "methicillin resistant",
             "staphylococcus aureus", "staph aureus"),
    "ecoli": ("escherichia coli", "e. coli", "e coli"),
    "kpneumoniae": ("klebsiella", "k. pneumoniae", "k pneumoniae"),
    "mtb": ("tuberculosis", "mycobacterium tuberculosis", " tb ", "latent tb"),
}


def match_modelled_pathogen(disease: str) -> str | None:
    """Return the pathogen key this system models for a condition, or None.

    This is the gate on percentages: a probability is only ever shown for a
    disease that has a trained, validated model behind it.
    """
    if not disease:
        return None
    text = f" {disease.lower()} "
    for key, patterns in AMR_DISEASE_PATTERNS.items():
        if any(p in text for p in patterns):
            return key
    return None


@st.cache_data(ttl=CACHE_TTL)
def clinical_coverage() -> dict[str, int]:
    """How much of the library has actually been checked against trial records.

    Without this, "no evidence found" would be indistinguishable from "never
    looked" - a difference that matters a great deal to a reader.
    """
    conn = open_conn()
    try:
        def n(sql: str) -> int:
            row = conn.execute(sql).fetchone()
            return int(row[0] or 0) if row else 0

        return {
            "medicines_total": n("SELECT COUNT(DISTINCT molecule_id) FROM drugs "
                                 "WHERE molecule_id IS NOT NULL"),
            # Only library medicines: a structure that a corrected match no
            # longer uses keeps its old query row, but is not a medicine here.
            "medicines_checked": n("SELECT COUNT(*) FROM clinical_queries WHERE molecule_id IN "
                                   "(SELECT molecule_id FROM drugs)"),
            "medicines_with_records": n("SELECT COUNT(DISTINCT molecule_id) FROM clinical_trials "
                                        "WHERE molecule_id IN (SELECT molecule_id FROM drugs)"),
            "studies": n("SELECT COUNT(*) FROM clinical_trials"),
            "conditions": n("SELECT COUNT(DISTINCT conditions) FROM clinical_trials "
                            "WHERE conditions IS NOT NULL AND TRIM(conditions) <> ''"),
        }
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def training_membership(molecule_id: str) -> dict[str, dict[str, Any]]:
    """Whether the ACTIVE model for each pathogen was trained on this molecule.

    A probability for a molecule the model already saw labelled is recall, not a
    prediction. Without this, a `>99%` beside a medicine the model memorised
    reads as a discovery. Returns ``{pathogen_key: {split, label, n_measurements,
    dataset_version}}`` and omits pathogens where the molecule carried no label.
    """
    conn = open_conn()
    try:
        rows = conn.execute(
            """SELECT dm.pathogen_key, dm.split, dm.label, dm.n_measurements,
                      dm.dataset_version
               FROM dataset_members dm
               JOIN model_versions mv ON mv.dataset_version = dm.dataset_version
                                     AND mv.pathogen_key = dm.pathogen_key
                                     AND mv.status = 'ACTIVE'
               WHERE dm.molecule_id = ?""",
            (molecule_id,),
        ).fetchall()
        return {r["pathogen_key"]: dict(r) for r in rows}
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def docking_coverage() -> dict[str, int]:
    """How much of the scored library has actually been docked.

    Docking is expensive, so only a shortlist is ever run. Showing the number of
    docked ligands without its denominator would let a reader assume the whole
    library was checked structurally, which it was not.
    """
    conn = open_conn()
    try:
        def n(sql: str) -> int:
            row = conn.execute(sql).fetchone()
            return int(row[0] or 0) if row else 0

        return {
            "medicines_total": n("SELECT COUNT(DISTINCT molecule_id) FROM drugs "
                                 "WHERE molecule_id IS NOT NULL"),
            "medicines_scored": n(_ACTIVE_PREDICTIONS_COUNT.format(
                what="COUNT(DISTINCT p.molecule_id)")),
            "medicines_docked": n("SELECT COUNT(DISTINCT molecule_id) FROM docking_results "
                                  "WHERE status = 'ok'"),
            "ligand_target_pairs": n("SELECT COUNT(DISTINCT molecule_id || target_key) "
                                     "FROM docking_results WHERE status = 'ok'"),
            "poses": n("SELECT COUNT(*) FROM docking_results WHERE status = 'ok'"),
            "failed": n("SELECT COUNT(DISTINCT molecule_id) FROM docking_results "
                        "WHERE status <> 'ok'"),
            "targets": n("SELECT COUNT(DISTINCT target_key) FROM docking_results "
                         "WHERE status = 'ok'"),
        }
    finally:
        conn.close()


#: Matches a condition as a whole element of a trial's ";"-joined condition list.
#: Substring matching would count "Migraine" for "Migraine Prophylaxis Failure" and
#: make the medicine counts disagree with the condition list the reader chose from.
_CONDITION_MATCH = (
    "INSTR(';' || LOWER(REPLACE(REPLACE(ct_conditions, '; ', ';'), ' ;', ';')) || ';', "
    "';' || ? || ';') > 0"
)


@st.cache_data(ttl=CACHE_TTL)
def disease_options(search: str = "", limit: int = 400) -> pd.DataFrame:
    """Conditions that actually appear in the retrieved trial records.

    The list is built from real data, so a condition only offered here if at
    least one registered study in the database names it.

    A single trial record can name dozens of conditions in one semicolon-joined
    string. Offering that whole string as a choice would be unreadable, and
    worse, a list containing "Methicillin Resistant Staphylococcus Aureus"
    somewhere among fifty other conditions would trip the model gate and show a
    probability for a mostly unrelated selection. So the string is split into
    individual conditions here, and each is counted on its own.
    """
    where = "WHERE term <> ''"
    params: list[Any] = []
    if search.strip():
        # A reader types "MRSA" or "TB"; the registry writes "Methicillin
        # Resistant Staphylococcus Aureus" and "Tuberculosis". Searching the
        # pathogen's own aliases as well means the shorthand finds the condition.
        needles = [search.strip().lower()]
        pathogen = match_modelled_pathogen(search)
        if pathogen:
            needles.extend(AMR_DISEASE_PATTERNS[pathogen])
        clause = " OR ".join("LOWER(term) LIKE ?" for _ in needles)
        where += f" AND ({clause})"
        params.extend(f"%{n.strip()}%" for n in needles)
    params.append(int(limit))
    return _df(
        f"""WITH RECURSIVE split(molecule_id, term, rest) AS (
                SELECT molecule_id, '', conditions || ';'
                FROM clinical_trials
                WHERE conditions IS NOT NULL AND TRIM(conditions) <> ''
                UNION ALL
                SELECT molecule_id,
                       TRIM(SUBSTR(rest, 1, INSTR(rest, ';') - 1)),
                       SUBSTR(rest, INSTR(rest, ';') + 1)
                FROM split WHERE rest <> ''
            )
            SELECT MIN(term) AS disease,
                   COUNT(DISTINCT molecule_id) AS medicines,
                   COUNT(*) AS studies
            FROM split {where}
            GROUP BY LOWER(term)
            ORDER BY medicines DESC, studies DESC
            LIMIT ?""",
        tuple(params),
    )


@st.cache_data(ttl=CACHE_TTL)
def medicine_disease_evidence(molecule_id: str, disease: str) -> dict[str, Any]:
    """All evidence this database holds for one medicine against one condition.

    Returns the three evidence streams separately, plus whether the medicine was
    ever checked at all. Nothing is inferred: if a stream is empty it is reported
    as empty, and a probability appears only when the condition maps onto a
    pathogen with a trained model.
    """
    conn = open_conn()
    try:
        checked = conn.execute(
            "SELECT * FROM clinical_queries WHERE molecule_id = ?", (molecule_id,)
        ).fetchone()

        trials = conn.execute(
            """SELECT nct_id, brief_title, conditions, interventions, phase,
                      overall_status, study_type, url, amr_related
               FROM clinical_trials
               WHERE molecule_id = ? AND """
            + _CONDITION_MATCH.replace("ct_conditions", "conditions")
            + """
               ORDER BY amr_related DESC, nct_id
               LIMIT 50""",
            (molecule_id, disease.strip().lower()),
        ).fetchall()

        pathogen = match_modelled_pathogen(disease)

        prediction = None
        docking: dict[str, Any] | None = None
        measured: list[dict[str, Any]] = []
        if pathogen:
            row = conn.execute(
                """SELECT p.probability, p.model_version, p.model_type, p.dataset_version,
                          p.predicted_at
                   FROM predictions p
                   JOIN model_versions mv ON mv.model_version = p.model_version
                   WHERE p.molecule_id = ? AND p.pathogen_key = ? AND mv.status = 'ACTIVE'
                   LIMIT 1""",
                (molecule_id, pathogen),
            ).fetchone()
            prediction = dict(row) if row else None

            docking = conn.execute(
                """SELECT dr.score_kcal_mol, dr.target_key, dr.pose_rank, dr.created_at,
                          dt.name AS target_name
                   FROM docking_results dr
                   LEFT JOIN targets dt ON dt.target_key = dr.target_key
                   WHERE dr.molecule_id = ? AND dr.pathogen_key = ?
                     AND dr.status = 'ok' AND dr.score_kcal_mol IS NOT NULL
                   ORDER BY dr.score_kcal_mol ASC LIMIT 1""",
                (molecule_id, pathogen),
            ).fetchone()
            docking = dict(docking) if docking else None

            measured = [dict(r) for r in conn.execute(
                """SELECT activity_type, activity_value, activity_units, activity_relation,
                          pactivity, label, assay_description
                   FROM bioactivity
                   WHERE molecule_id = ? AND pathogen_key = ? AND label IS NOT NULL
                   ORDER BY pactivity DESC LIMIT 25""",
                (molecule_id, pathogen),
            ).fetchall()]

        return {
            "molecule_id": molecule_id,
            "disease": disease,
            "modelled_pathogen": pathogen,
            "was_checked": checked is not None,
            "checked_at": checked["retrieved_at"] if checked else None,
            "trials": [dict(r) for r in trials],
            "prediction": prediction,
            "measured": measured,
            "docking": docking,
        }
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def medicines_for_disease(disease: str, limit: int = 60) -> pd.DataFrame:
    """Medicines with registered studies naming this condition.

    When the condition maps onto a modelled pathogen, each medicine also carries
    its stored AI-predicted activity, best docking score and laboratory-
    measurement count. For every other condition those columns come back empty
    rather than filled with a number this system cannot support.
    """
    if not disease.strip():
        return pd.DataFrame()
    pathogen = match_modelled_pathogen(disease)
    # The studies are counted before the name lookup is joined on. A medicine can
    # have several rows in `drugs` (brands, strengths), and counting after that
    # join multiplied every study by the number of brand rows - which showed 26
    # studies where the database holds one.
    return _df(
        """WITH matched AS (
               SELECT molecule_id,
                      COUNT(*) AS studies,
                      SUM(amr_related) AS infection_studies,
                      MIN(phase) AS earliest_phase,
                      MIN(query_term) AS query_term
               FROM clinical_trials
               WHERE """ + _CONDITION_MATCH.replace("ct_conditions", "conditions") + """
               GROUP BY molecule_id
           )
           SELECT ma.molecule_id,
                  COALESCE(MIN(d.generic_name), m.pref_name, ma.query_term) AS medicine,
                  ma.studies, ma.infection_studies, ma.earliest_phase,
                  (SELECT p.probability FROM predictions p
                    JOIN model_versions mv ON mv.model_version = p.model_version
                   WHERE p.molecule_id = ma.molecule_id AND p.pathogen_key = ?
                     AND mv.status = 'ACTIVE' LIMIT 1) AS probability,
                  (SELECT MIN(dr.score_kcal_mol) FROM docking_results dr
                   WHERE dr.molecule_id = ma.molecule_id AND dr.pathogen_key = ?
                     AND dr.status = 'ok') AS docking_score,
                  (SELECT COUNT(*) FROM bioactivity b
                   WHERE b.molecule_id = ma.molecule_id AND b.pathogen_key = ?
                     AND b.label IS NOT NULL) AS measurements
           FROM matched ma
           JOIN molecules m ON m.molecule_id = ma.molecule_id
           LEFT JOIN drugs d ON d.molecule_id = ma.molecule_id
           GROUP BY ma.molecule_id
           ORDER BY ma.studies DESC, medicine
           LIMIT ?""",
        (disease.strip().lower(), pathogen, pathogen, pathogen, int(limit)),
    )


@st.cache_data(ttl=CACHE_TTL)
def predictions_for(molecule_ids: tuple[str, ...]) -> pd.DataFrame:
    """Every active-model prediction for a set of molecules, one row per pair.

    Used by the candidate cards, which show all four bacteria for one medicine
    rather than only the pathogen currently being explored.
    """
    if not molecule_ids:
        return pd.DataFrame(columns=["molecule_id", "pathogen_key", "probability"])
    marks = ",".join("?" for _ in molecule_ids)
    return _df(
        f"""SELECT p.molecule_id, p.pathogen_key, p.probability
            FROM predictions p
            JOIN model_versions mv ON mv.model_version = p.model_version
            WHERE p.molecule_id IN ({marks}) AND mv.status = 'ACTIVE'""",
        tuple(molecule_ids),
    )


@st.cache_data(ttl=CACHE_TTL)
def evidence_flags(molecule_ids: tuple[str, ...]) -> pd.DataFrame:
    """Which kinds of evidence exist for each molecule.

    Answers the candidate card's checklist: is there a laboratory measurement, a
    docking result, a clinical record? A missing kind is an absence of evidence,
    never a negative finding.
    """
    if not molecule_ids:
        return pd.DataFrame(columns=["molecule_id", "measured", "docked", "clinical"])
    marks = ",".join("?" for _ in molecule_ids)
    ids = tuple(molecule_ids)
    return _df(
        f"""SELECT m.molecule_id,
                   EXISTS(SELECT 1 FROM bioactivity b
                          WHERE b.molecule_id = m.molecule_id AND b.label IS NOT NULL) AS measured,
                   EXISTS(SELECT 1 FROM docking_results d
                          WHERE d.molecule_id = m.molecule_id AND d.status = 'ok') AS docked,
                   EXISTS(SELECT 1 FROM clinical_trials c
                          WHERE c.molecule_id = m.molecule_id) AS clinical
            FROM molecules m
            WHERE m.molecule_id IN ({marks})""",
        ids,
    )


@st.cache_data(ttl=CACHE_TTL)
def documented_uses(molecule_id: str, limit: int = 12) -> pd.DataFrame:
    """Conditions this medicine has actually been studied for in registered trials.

    This is *documented history*, not a prediction: every row is backed by real
    ClinicalTrials.gov records and the count of studies behind it. It is the
    honest answer to "what else is this medicine used for?" - the alternative
    would be inventing a probability for a disease this system does not model.

    AMR-related conditions are excluded so the list answers the repurposing
    question (what else has this been studied for) rather than repeating the
    antibacterial context shown elsewhere.
    """
    return _df(
        """SELECT conditions AS condition,
                  COUNT(*) AS studies,
                  MIN(phase) AS earliest_phase,
                  GROUP_CONCAT(DISTINCT overall_status) AS statuses
           FROM clinical_trials
           WHERE molecule_id = ?
             AND amr_related = 0
             AND conditions IS NOT NULL AND TRIM(conditions) <> ''
           GROUP BY conditions
           ORDER BY studies DESC, condition
           LIMIT ?""",
        (molecule_id, int(limit)),
    )


@st.cache_data(ttl=CACHE_TTL)
def measured_activity_pathogens(molecule_id: str) -> set[str]:
    """Pathogens for which this compound has a real laboratory measurement."""
    rows = _df(
        """SELECT DISTINCT pathogen_key FROM bioactivity
           WHERE molecule_id = ? AND label IS NOT NULL""",
        (molecule_id,),
    )
    return set(rows["pathogen_key"]) if not rows.empty else set()


@st.cache_data(ttl=CACHE_TTL)
def search_molecules(term: str, limit: int = 40) -> pd.DataFrame:
    """Medicines matching a typed fragment, single ingredients before mixtures.

    Ordering matters here: a search for "topiramate" that puts
    "PHENTERMINE HYDROCHLORIDE; TOPIRAMATE" first hands the reader a different
    medicine than the one they asked for. Exact names rank first, then names
    that start with the term, then the shortest.
    """
    if not term or not term.strip():
        return pd.DataFrame()
    token = f"%{term.strip().lower()}%"
    return _df(
        """SELECT m.molecule_id,
                  COALESCE(MIN(d.generic_name), m.pref_name, m.molecule_id) AS drug,
                  m.chembl_id, m.inchikey, m.mw
           FROM molecules m
           LEFT JOIN drugs d ON d.molecule_id = m.molecule_id
           WHERE m.is_valid = 1 AND (
                 LOWER(COALESCE(m.pref_name,'')) LIKE ?
              OR LOWER(COALESCE(d.generic_name,'')) LIKE ?
              OR LOWER(COALESCE(d.brand_name,'')) LIKE ?
              OR LOWER(COALESCE(m.chembl_id,'')) LIKE ?
              OR LOWER(COALESCE(m.inchikey,'')) LIKE ?
              OR LOWER(COALESCE(m.canonical_smiles,'')) LIKE ?)
           GROUP BY m.molecule_id
           ORDER BY CASE
                        WHEN LOWER(drug) = ? THEN 0
                        WHEN LOWER(drug) LIKE ? THEN 1
                        ELSE 2
                    END,
                    LENGTH(drug), drug
           LIMIT ?""",
        (token, token, token, token, token, token,
         term.strip().lower(), f"{term.strip().lower()}%", int(limit)),
    )


# ---------------------------------------------------------------- models ----
@st.cache_data(ttl=CACHE_TTL)
def model_versions() -> pd.DataFrame:
    return _df(
        """SELECT model_version, pathogen_key, model_type, is_baseline, status,
                  dataset_version, feature_version, training_date, split_method,
                  validation_method, random_seed, n_train, n_validation, n_test,
                  metrics_json, cv_metrics_json, selection_reason, artifact_path,
                  library_versions
           FROM model_versions ORDER BY pathogen_key, training_date DESC"""
    )


@st.cache_data(ttl=CACHE_TTL)
def benchmark_table(pathogen: str) -> pd.DataFrame:
    df = _df(
        """SELECT benchmark_run_id, model_type, model_version, is_baseline, selected,
                  metrics_json, cv_metrics_json, created_at, dataset_version
           FROM model_benchmarks WHERE pathogen_key = ?
           ORDER BY created_at DESC""",
        (pathogen,),
    )
    if df.empty:
        return df
    latest = df.iloc[0]["benchmark_run_id"]
    return df[df["benchmark_run_id"] == latest].reset_index(drop=True)


@st.cache_data(ttl=CACHE_TTL)
def dataset_versions() -> pd.DataFrame:
    return _df(
        """SELECT dataset_version, created_at, n_records, n_compounds, n_pathogens,
                  quality_json, labeling_json, config_hash, notes
           FROM dataset_versions ORDER BY created_at DESC"""
    )


@st.cache_data(ttl=CACHE_TTL)
def model_curves(model_version: str) -> dict[str, Any]:
    """ROC / PR curve points, stored at training time and never recomputed.

    Returns ``{"roc": ..., "pr": ..., "calibration": ...}``; empty when the model
    predates curve storage, in which case the page says so rather than drawing a
    chart from nothing.
    """
    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT curves_json FROM model_versions WHERE model_version = ?",
            (model_version,),
        ).fetchone()
        if row is None or not row["curves_json"]:
            return {}
        try:
            stored = json.loads(row["curves_json"])
        except json.JSONDecodeError:
            return {}
        test = stored.get("test") or {}
        return {
            "roc": test.get("roc"),
            "pr": test.get("pr"),
            "calibration": stored.get("calibration"),
        }
    finally:
        conn.close()


@st.cache_data(ttl=30)
def system_status() -> dict[str, Any]:
    """Live state for the sidebar indicators and page headers.

    Every value is derived from the database. Nothing here is hard-coded: an
    indicator that always reads "healthy" would be decoration, not status.
    """
    cfg = get_config()
    conn = open_conn()
    try:
        def n(sql: str) -> int:
            row = conn.execute(sql).fetchone()
            return int(row[0] or 0) if row else 0

        molecules = n("SELECT COUNT(*) FROM molecules WHERE is_valid = 1")
        active_models = n("SELECT COUNT(*) FROM model_versions WHERE status = 'ACTIVE'")
        predictions = n(_ACTIVE_PREDICTIONS_COUNT.format(what="COUNT(*)"))
        n_pathogens = len(cfg.pathogens)

        last = conn.execute(
            """SELECT stage, status, started_at, finished_at, error_count
               FROM pipeline_runs ORDER BY started_at DESC LIMIT 1"""
        ).fetchone()

        recent_failures = n(
            "SELECT COUNT(*) FROM pipeline_runs WHERE status = 'FAILED' "
            "AND started_at >= datetime('now', '-1 day')"
        )
        stuck = n("SELECT COUNT(*) FROM docking_runs WHERE status = 'RUNNING'")

        data_kind = "clinical" if molecules else "limitation"
        data_label = (f"{molecules:,} structures loaded" if molecules
                      else "No structures ingested")

        if active_models >= n_pathogens:
            model_kind, model_label = "clinical", f"{active_models} of {n_pathogens} models active"
        elif active_models:
            model_kind, model_label = "limitation", f"{active_models} of {n_pathogens} models active"
        else:
            model_kind, model_label = "failure", "No active model"

        if recent_failures:
            pipe_kind = "failure"
            pipe_label = f"{recent_failures} failed run(s) in 24h"
        elif stuck:
            pipe_kind, pipe_label = "limitation", f"{stuck} run(s) still marked running"
        elif last is None:
            pipe_kind, pipe_label = "limitation", "Pipeline never run"
        else:
            pipe_kind, pipe_label = "clinical", "Pipeline healthy"

        return {
            "indicators": [
                (data_label, data_kind),
                (model_label, model_kind),
                (pipe_label, pipe_kind),
            ],
            "last_run_stage": last["stage"] if last else None,
            "last_run_at": (last["finished_at"] or last["started_at"]) if last else None,
            "last_run_status": last["status"] if last else None,
            "active_models": active_models,
            "n_pathogens": n_pathogens,
            "predictions": predictions,
            "valid_molecules": molecules,
        }
    finally:
        conn.close()


@st.cache_data(ttl=30)
def header_meta() -> list[tuple[str, str]]:
    """The three live values shown beside every page title."""
    status = system_status()
    when = status["last_run_at"] or "never"
    if isinstance(when, str) and "T" in when:
        when = when.split("+")[0].replace("T", " ")
    stage = status["last_run_stage"] or "—"
    return [
        ("Last pipeline run", f"{stage} · {when}"),
        ("Active models", f"{status['active_models']} of {status['n_pathogens']}"),
        ("Stored predictions", f"{status['predictions']:,}"),
    ]


@st.cache_data(ttl=CACHE_TTL)
def strain_evidence() -> pd.DataFrame:
    """How much of each pathogen's labelled evidence names a resistant strain.

    The pathogens are named for resistant organisms, but most published MICs are
    measured on susceptible reference strains. This is the difference between
    predicting antibacterial activity and predicting activity against the
    resistant phenotype, so the dashboard states it rather than implying the
    stronger claim.
    """
    return _df(
        """SELECT pathogen_key,
                  COUNT(*) AS labelled_records,
                  COALESCE(SUM(strain_specific), 0) AS resistant_records,
                  COUNT(DISTINCT molecule_id) AS compounds,
                  COUNT(DISTINCT CASE WHEN strain_specific = 1 THEN molecule_id END)
                      AS resistant_compounds
           FROM bioactivity
           WHERE label IS NOT NULL
           GROUP BY pathogen_key"""
    )


@st.cache_data(ttl=CACHE_TTL)
def label_distribution() -> pd.DataFrame:
    return _df(
        """SELECT pathogen_key,
                  SUM(CASE WHEN label = 1 THEN 1 ELSE 0 END) AS active,
                  SUM(CASE WHEN label = 0 THEN 1 ELSE 0 END) AS inactive,
                  SUM(CASE WHEN label IS NULL THEN 1 ELSE 0 END) AS unusable
           FROM bioactivity GROUP BY pathogen_key"""
    )


@st.cache_data(ttl=CACHE_TTL)
def probability_distribution(pathogen: str) -> pd.DataFrame:
    return _df(
        """SELECT probability FROM predictions
           WHERE pathogen_key = ?
             AND model_version = (SELECT model_version FROM model_versions
                                  WHERE pathogen_key = ? AND status='ACTIVE'
                                  ORDER BY training_date DESC LIMIT 1)""",
        (pathogen, pathogen),
    )


# --------------------------------------------------------------- docking ----
@st.cache_data(ttl=CACHE_TTL)
def docking_targets() -> pd.DataFrame:
    return _df("SELECT * FROM targets ORDER BY pathogen_key")


@st.cache_data(ttl=CACHE_TTL)
def docking_runs() -> pd.DataFrame:
    return _df("SELECT * FROM docking_runs ORDER BY started_at DESC")


@st.cache_data(ttl=CACHE_TTL)
def docking_results(target_key: str | None = None, limit: int = 300) -> pd.DataFrame:
    where = "WHERE dr.status='ok' AND dr.pose_rank = 1"
    params: list[Any] = []
    if target_key:
        where += " AND dr.target_key = ?"
        params.append(target_key)
    params.append(int(limit))
    return _df(
        f"""SELECT dr.molecule_id, dr.target_key, dr.pathogen_key, dr.score_kcal_mol,
                   dr.pose_path, dr.run_id,
                   COALESCE(MIN(d.generic_name), m.pref_name, dr.molecule_id) AS drug,
                   m.canonical_smiles, p.probability AS ml_probability,
                   t.name AS target_name, t.pdb_id
            FROM docking_results dr
            JOIN molecules m ON m.molecule_id = dr.molecule_id
            LEFT JOIN drugs d ON d.molecule_id = dr.molecule_id
            LEFT JOIN targets t ON t.target_key = dr.target_key
            LEFT JOIN predictions p ON p.molecule_id = dr.molecule_id
                                   AND p.pathogen_key = dr.pathogen_key
                                   AND p.model_version = (SELECT mv.model_version
                                                          FROM model_versions mv
                                                          WHERE mv.pathogen_key = dr.pathogen_key
                                                            AND mv.status = 'ACTIVE' LIMIT 1)
            {where}
            GROUP BY dr.molecule_id, dr.target_key
            ORDER BY dr.score_kcal_mol ASC
            LIMIT ?""",
        tuple(params),
    )


@st.cache_data(ttl=CACHE_TTL)
def docking_failures(limit: int = 100) -> pd.DataFrame:
    return _df(
        """SELECT molecule_id, target_key, error, created_at FROM docking_results
           WHERE status <> 'ok' ORDER BY created_at DESC LIMIT ?""",
        (int(limit),),
    )


def read_pose(pose_path: str | None) -> str | None:
    """Read a stored PDBQT pose from disk for 3D display."""
    if not pose_path:
        return None
    path = Path(pose_path)
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


# -------------------------------------------------------------- clinical ----
@st.cache_data(ttl=CACHE_TTL)
def clinical_table(amr_only: bool = False, limit: int = 500) -> pd.DataFrame:
    where = "WHERE ct.amr_related = 1" if amr_only else ""
    return _df(
        f"""SELECT ct.nct_id, ct.molecule_id,
                   COALESCE(MIN(d.generic_name), m.pref_name, ct.query_term) AS drug,
                   ct.brief_title, ct.conditions, ct.interventions, ct.phase,
                   ct.overall_status, ct.study_type, ct.start_date, ct.url,
                   ct.amr_related, ct.matched_keywords
            FROM clinical_trials ct
            LEFT JOIN molecules m ON m.molecule_id = ct.molecule_id
            LEFT JOIN drugs d ON d.molecule_id = ct.molecule_id
            {where}
            GROUP BY ct.nct_id, ct.molecule_id
            ORDER BY ct.amr_related DESC, ct.nct_id
            LIMIT ?""",
        (int(limit),),
    )


# -------------------------------------------------------------- pipeline ----
@st.cache_data(ttl=30)
def pipeline_runs(limit: int = 100) -> pd.DataFrame:
    return _df(
        """SELECT run_id, stage, started_at, finished_at, duration_seconds, status,
                  records_processed, records_new, records_skipped, error_count, message
           FROM pipeline_runs ORDER BY started_at DESC LIMIT ?""",
        (int(limit),),
    )


@st.cache_data(ttl=30)
def latest_stage_runs() -> pd.DataFrame:
    return _df(
        """SELECT stage, run_id, started_at, finished_at, status, records_processed,
                  records_new, records_skipped, error_count, duration_seconds
           FROM pipeline_runs
           WHERE (stage, started_at) IN (SELECT stage, MAX(started_at) FROM pipeline_runs GROUP BY stage)
           ORDER BY started_at DESC"""
    )


@st.cache_data(ttl=30)
def run_errors(run_id: str, limit: int = 100) -> pd.DataFrame:
    return _df(
        "SELECT subject, error_type, message, created_at FROM pipeline_errors "
        "WHERE run_id = ? ORDER BY created_at DESC LIMIT ?",
        (run_id, int(limit)),
    )


@st.cache_data(ttl=30)
def new_drugs(limit: int = 200) -> pd.DataFrame:
    return _df(
        """SELECT d.drug_id, d.generic_name, d.brand_name, d.approval_source,
                  d.first_seen_at, d.processing_status, d.prediction_status,
                  d.match_method, d.molecule_id,
                  (SELECT COUNT(*) FROM predictions p WHERE p.molecule_id = d.molecule_id) AS n_predictions
           FROM drugs d
           ORDER BY d.first_seen_at DESC, d.generic_name
           LIMIT ?""",
        (int(limit),),
    )


@st.cache_data(ttl=CACHE_TTL)
def data_sources() -> pd.DataFrame:
    return _df(
        "SELECT name, url, source_version, retrieved_at, record_count, is_demo, notes "
        "FROM data_sources ORDER BY retrieved_at DESC LIMIT 50"
    )


@st.cache_data(ttl=CACHE_TTL)
def retraining_status() -> dict[str, Any]:
    from src.pipeline.train import retraining_status as status_fn

    cfg = get_config()
    conn = open_conn()
    try:
        return status_fn(conn, cfg)
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def sanity_findings(model_version: str) -> list[dict[str, Any]]:
    from src.ml.sanity import check_model

    conn = open_conn()
    try:
        return [
            {"check": f.check, "severity": f.severity, "message": f.message, "detail": f.detail}
            for f in check_model(conn, model_version)
        ]
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def dataset_sanity(dataset_version: str) -> list[dict[str, Any]]:
    from src.ml.sanity import check_dataset

    conn = open_conn()
    try:
        return [
            {"check": f.check, "severity": f.severity, "message": f.message, "detail": f.detail}
            for f in check_dataset(conn, dataset_version)
        ]
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL)
def feature_importance(pathogen: str, top_n: int = 20) -> list[dict[str, Any]]:
    from src.ml.predict import feature_importance_for

    conn = open_conn()
    try:
        return feature_importance_for(conn, pathogen, top_n=top_n)
    finally:
        conn.close()
