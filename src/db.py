"""SQLite persistence layer.

Every stored result carries provenance: which source it came from, which
dataset and model version produced it, and whether it is demo data. The schema
is created idempotently so the pipeline can be re-run over an existing
database.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from .config import Config, load_config

SCHEMA_VERSION = 1

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_info (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Free-form key/value store for pipeline state (active dataset version, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- sources --
CREATE TABLE IF NOT EXISTS data_sources (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    url            TEXT,
    source_version TEXT,
    retrieved_at   TEXT NOT NULL,
    record_count   INTEGER,
    is_demo        INTEGER NOT NULL DEFAULT 0,
    notes          TEXT
);

-- -------------------------------------------------------------- pathogens --
CREATE TABLE IF NOT EXISTS pathogens (
    key       TEXT PRIMARY KEY,
    label     TEXT NOT NULL,
    full_name TEXT NOT NULL,
    organism  TEXT NOT NULL,
    tax_id    INTEGER
);

-- -------------------------------------------------------------- molecules --
-- molecule_id is the standard InChIKey when RDKit can produce one, otherwise a
-- deterministic hash of the canonical SMILES. It is the join key everywhere.
CREATE TABLE IF NOT EXISTS molecules (
    molecule_id         TEXT PRIMARY KEY,
    chembl_id           TEXT,
    pref_name           TEXT,
    input_smiles        TEXT,
    canonical_smiles    TEXT,
    inchi               TEXT,
    inchikey            TEXT,
    mw                  REAL,
    logp                REAL,
    tpsa                REAL,
    hbd                 INTEGER,
    hba                 INTEGER,
    rotatable_bonds     INTEGER,
    aromatic_rings      INTEGER,
    heavy_atoms         INTEGER,
    fraction_csp3       REAL,
    qed                 REAL,
    lipinski_violations INTEGER,
    murcko_scaffold     TEXT,
    fingerprint         BLOB,
    feature_version     TEXT,
    is_valid            INTEGER NOT NULL DEFAULT 0,
    validation_error    TEXT,
    is_demo             INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_molecules_chembl ON molecules(chembl_id);
CREATE INDEX IF NOT EXISTS idx_molecules_inchikey ON molecules(inchikey);
CREATE INDEX IF NOT EXISTS idx_molecules_valid ON molecules(is_valid);
CREATE INDEX IF NOT EXISTS idx_molecules_scaffold ON molecules(murcko_scaffold);

-- ------------------------------------------------------------------ drugs --
-- Approved human drugs. approval_source records which FDA feed the record came
-- from so the dashboard never implies more provenance than exists.
CREATE TABLE IF NOT EXISTS drugs (
    drug_id           TEXT PRIMARY KEY,
    molecule_id       TEXT REFERENCES molecules(molecule_id),
    generic_name      TEXT NOT NULL,
    brand_name        TEXT,
    approval_source   TEXT NOT NULL,
    approval_status   TEXT,
    application_no    TEXT,
    application_type  TEXT,
    marketing_status  TEXT,
    dosage_form       TEXT,
    route             TEXT,
    approval_date     TEXT,
    chembl_id         TEXT,
    match_method      TEXT,
    ingredients       TEXT,              -- the product's full Orange Book ingredient field
    first_seen_at     TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'pending',
    prediction_status TEXT NOT NULL DEFAULT 'pending',
    is_demo           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_drugs_molecule ON drugs(molecule_id);
CREATE INDEX IF NOT EXISTS idx_drugs_generic ON drugs(generic_name);
CREATE INDEX IF NOT EXISTS idx_drugs_status ON drugs(prediction_status);

-- ------------------------------------------------------------ bioactivity --
CREATE TABLE IF NOT EXISTS bioactivity (
    activity_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_activity_id  TEXT,
    source              TEXT NOT NULL,
    molecule_id         TEXT REFERENCES molecules(molecule_id),
    chembl_id           TEXT,
    pathogen_key        TEXT NOT NULL REFERENCES pathogens(key),
    organism            TEXT,
    target_chembl_id    TEXT,
    target_pref_name    TEXT,
    assay_chembl_id     TEXT,
    assay_description   TEXT,
    assay_type          TEXT,
    activity_type       TEXT,
    activity_value      REAL,
    activity_units      TEXT,
    activity_relation   TEXT,
    pchembl_value       REAL,
    pactivity           REAL,
    pactivity_method    TEXT,
    label               INTEGER,
    label_reason        TEXT,
    strain_specific     INTEGER NOT NULL DEFAULT 0,
    document_chembl_id  TEXT,
    document_year       INTEGER,
    is_demo             INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    UNIQUE(source, source_activity_id)
);
CREATE INDEX IF NOT EXISTS idx_bioactivity_mol ON bioactivity(molecule_id);
CREATE INDEX IF NOT EXISTS idx_bioactivity_pathogen ON bioactivity(pathogen_key);
CREATE INDEX IF NOT EXISTS idx_bioactivity_label ON bioactivity(label);

-- -------------------------------------------------------------- datasets ---
CREATE TABLE IF NOT EXISTS dataset_versions (
    dataset_version TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    n_records       INTEGER,
    n_compounds     INTEGER,
    n_pathogens     INTEGER,
    labeling_json   TEXT,
    quality_json    TEXT,
    config_hash     TEXT,
    artifact_path   TEXT,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS dataset_members (
    dataset_version TEXT NOT NULL REFERENCES dataset_versions(dataset_version),
    molecule_id     TEXT NOT NULL,
    pathogen_key    TEXT NOT NULL,
    label           INTEGER NOT NULL,
    pactivity       REAL,
    n_measurements  INTEGER,
    split           TEXT,
    scaffold        TEXT,
    PRIMARY KEY (dataset_version, molecule_id, pathogen_key)
);
CREATE INDEX IF NOT EXISTS idx_members_split ON dataset_members(dataset_version, pathogen_key, split);

-- ---------------------------------------------------------------- models ---
CREATE TABLE IF NOT EXISTS model_versions (
    model_version     TEXT PRIMARY KEY,
    pathogen_key      TEXT NOT NULL REFERENCES pathogens(key),
    model_type        TEXT NOT NULL,
    is_baseline       INTEGER NOT NULL DEFAULT 0,
    dataset_version   TEXT NOT NULL,
    feature_version   TEXT NOT NULL,
    training_date     TEXT NOT NULL,
    validation_method TEXT,
    split_method      TEXT,
    random_seed       INTEGER,
    n_train           INTEGER,
    n_validation      INTEGER,
    n_test            INTEGER,
    metrics_json      TEXT,
    cv_metrics_json   TEXT,
    curves_json       TEXT,
    selection_reason  TEXT,
    artifact_path     TEXT,
    status            TEXT NOT NULL DEFAULT 'CANDIDATE',
    library_versions  TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_pathogen_status ON model_versions(pathogen_key, status);

-- One row per model trained during a benchmark run, so the comparison table in
-- the dashboard is read from stored evaluations and never recomputed or faked.
CREATE TABLE IF NOT EXISTS model_benchmarks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_run_id TEXT NOT NULL,
    pathogen_key     TEXT NOT NULL,
    model_type       TEXT NOT NULL,
    model_version    TEXT,
    dataset_version  TEXT NOT NULL,
    is_baseline      INTEGER NOT NULL DEFAULT 0,
    selected         INTEGER NOT NULL DEFAULT 0,
    metrics_json     TEXT NOT NULL,
    cv_metrics_json  TEXT,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bench_run ON model_benchmarks(benchmark_run_id, pathogen_key);

-- ----------------------------------------------------------- predictions ---
CREATE TABLE IF NOT EXISTS predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    molecule_id     TEXT NOT NULL REFERENCES molecules(molecule_id),
    pathogen_key    TEXT NOT NULL REFERENCES pathogens(key),
    probability     REAL NOT NULL,
    model_version   TEXT NOT NULL,
    model_type      TEXT,
    dataset_version TEXT,
    feature_version TEXT,
    predicted_at    TEXT NOT NULL,
    is_demo         INTEGER NOT NULL DEFAULT 0,
    UNIQUE(molecule_id, pathogen_key, model_version)
);
CREATE INDEX IF NOT EXISTS idx_pred_pathogen ON predictions(pathogen_key, probability DESC);
CREATE INDEX IF NOT EXISTS idx_pred_molecule ON predictions(molecule_id);

-- --------------------------------------------------------------- docking ---
CREATE TABLE IF NOT EXISTS targets (
    target_key      TEXT PRIMARY KEY,
    pathogen_key    TEXT NOT NULL REFERENCES pathogens(key),
    name            TEXT NOT NULL,
    gene            TEXT,
    pdb_id          TEXT NOT NULL,
    chain           TEXT NOT NULL,
    uniprot         TEXT,
    site_mode       TEXT NOT NULL,
    site_reference  TEXT,
    box_center_x    REAL,
    box_center_y    REAL,
    box_center_z    REAL,
    box_size_x      REAL,
    box_size_y      REAL,
    box_size_z      REAL,
    receptor_path   TEXT,
    structure_url   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    error           TEXT,
    selection_notes TEXT,
    prepared_at     TEXT
);

CREATE TABLE IF NOT EXISTS docking_runs (
    run_id            TEXT PRIMARY KEY,
    target_key        TEXT NOT NULL REFERENCES targets(target_key),
    pathogen_key      TEXT NOT NULL,
    engine            TEXT NOT NULL,
    engine_version    TEXT,
    exhaustiveness    INTEGER,
    num_modes         INTEGER,
    energy_range      REAL,
    random_seed       INTEGER,
    box_center_x      REAL,
    box_center_y      REAL,
    box_center_z      REAL,
    box_size_x        REAL,
    box_size_y        REAL,
    box_size_z        REAL,
    receptor_pdbqt    TEXT,
    n_ligands         INTEGER,
    n_succeeded       INTEGER,
    n_failed          INTEGER,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    status            TEXT NOT NULL,
    error             TEXT
);

CREATE TABLE IF NOT EXISTS docking_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL REFERENCES docking_runs(run_id),
    molecule_id     TEXT NOT NULL REFERENCES molecules(molecule_id),
    target_key      TEXT NOT NULL,
    pathogen_key    TEXT NOT NULL,
    pose_rank       INTEGER NOT NULL,
    score_kcal_mol  REAL,
    rmsd_lb         REAL,
    rmsd_ub         REAL,
    pose_path       TEXT,
    status          TEXT NOT NULL,
    error           TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE(run_id, molecule_id, pose_rank)
);
CREATE INDEX IF NOT EXISTS idx_dock_mol ON docking_results(molecule_id, target_key);
CREATE INDEX IF NOT EXISTS idx_dock_score ON docking_results(pathogen_key, score_kcal_mol);

-- -------------------------------------------------------------- clinical ---
CREATE TABLE IF NOT EXISTS clinical_trials (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nct_id         TEXT NOT NULL,
    molecule_id    TEXT REFERENCES molecules(molecule_id),
    query_term     TEXT NOT NULL,
    brief_title    TEXT,
    conditions     TEXT,
    interventions  TEXT,
    phase          TEXT,
    overall_status TEXT,
    study_type     TEXT,
    start_date     TEXT,
    completion_date TEXT,
    enrollment     INTEGER,
    url            TEXT,
    amr_related    INTEGER NOT NULL DEFAULT 0,
    matched_keywords TEXT,
    retrieved_at   TEXT NOT NULL,
    is_demo        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(nct_id, molecule_id)
);
CREATE INDEX IF NOT EXISTS idx_trials_mol ON clinical_trials(molecule_id);
CREATE INDEX IF NOT EXISTS idx_trials_amr ON clinical_trials(amr_related);

-- Records that a drug was queried, even when the query returned nothing. Without
-- this the dashboard cannot distinguish "no trials" from "never looked".
CREATE TABLE IF NOT EXISTS clinical_queries (
    molecule_id  TEXT PRIMARY KEY REFERENCES molecules(molecule_id),
    query_term   TEXT NOT NULL,
    n_results    INTEGER NOT NULL,
    n_amr        INTEGER NOT NULL,
    status       TEXT NOT NULL,
    error        TEXT,
    retrieved_at TEXT NOT NULL
);

-- ------------------------------------------------------- existing use ----
-- What each approved medicine is already classified and approved for, from WHO
-- ATC codes (via ChEMBL), FDA Established Pharmacologic Classes (openFDA labels)
-- and ChEMBL's approved indications. See src/ingestion/classification.py.
CREATE TABLE IF NOT EXISTS medicine_classes (
    molecule_id  TEXT NOT NULL REFERENCES molecules(molecule_id),
    system       TEXT NOT NULL,          -- 'WHO ATC' | 'FDA EPC'
    code         TEXT NOT NULL,          -- ATC level-5 code, or the FDA class text
    name         TEXT,                   -- ATC substance name / FDA class
    group_name   TEXT,                   -- ATC level-4 description
    therapeutic_group TEXT,              -- ATC level-2 description
    source_ref   TEXT,                   -- ChEMBL id or FDA application number
    retrieved_at TEXT NOT NULL,
    PRIMARY KEY (molecule_id, system, code)
);

CREATE TABLE IF NOT EXISTS medicine_indications (
    molecule_id  TEXT NOT NULL REFERENCES molecules(molecule_id),
    indication   TEXT NOT NULL,
    mesh_heading TEXT,
    source_ref   TEXT,                   -- ChEMBL id the indication is recorded on
    ref_url      TEXT,                   -- the FDA / DailyMed label ChEMBL cites
    retrieved_at TEXT NOT NULL,
    PRIMARY KEY (molecule_id, indication)
);

-- One row per medicine whose classification was looked up. No row means "not
-- yet checked"; status 'unclassified' means "checked, no source classifies it".
CREATE TABLE IF NOT EXISTS medicine_use_status (
    molecule_id      TEXT PRIMARY KEY REFERENCES molecules(molecule_id),
    status           TEXT NOT NULL,      -- antibacterial | other_anti_infective | not_anti_infective | unclassified
    is_antibacterial TEXT NOT NULL,      -- 'true' | 'false' | 'unclassified'
    basis            TEXT,               -- the codes/classes that decided it, '; '-separated
    rule_version     TEXT NOT NULL,
    fda_label_set_id TEXT,
    retrieved_at     TEXT NOT NULL
);

-- ------------------------------------------------------------- pipeline ----
CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id             TEXT PRIMARY KEY,
    stage              TEXT NOT NULL,
    started_at         TEXT NOT NULL,
    finished_at        TEXT,
    duration_seconds   REAL,
    status             TEXT NOT NULL,
    records_processed  INTEGER NOT NULL DEFAULT 0,
    records_new        INTEGER NOT NULL DEFAULT 0,
    records_skipped    INTEGER NOT NULL DEFAULT 0,
    error_count        INTEGER NOT NULL DEFAULT 0,
    params_json        TEXT,
    message            TEXT,
    is_demo            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_runs(stage, started_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT NOT NULL REFERENCES pipeline_runs(run_id),
    stage      TEXT NOT NULL,
    subject    TEXT,
    error_type TEXT,
    message    TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_run ON pipeline_errors(run_id);
"""


def utcnow() -> str:
    """ISO-8601 UTC timestamp used for every stored record."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(cfg: Config | None = None, path: Path | None = None) -> sqlite3.Connection:
    """Open a connection with sane pragmas and row access by name."""
    cfg = cfg or load_config()
    db_path = path or cfg.db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=60.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


@contextmanager
def session(cfg: Config | None = None, path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Transactional connection: commits on success, rolls back on error."""
    conn = connect(cfg, path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


#: Columns added after the first release. ``CREATE TABLE IF NOT EXISTS`` leaves
#: an existing table untouched, so new columns are added explicitly.
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("model_versions", "curves_json", "TEXT"),
    ("drugs", "ingredients", "TEXT"),
    ("medicine_use_status", "is_antibacterial", "TEXT"),
]


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Add columns introduced after a database was first created."""
    for table, column, column_type in _MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if existing and column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


def init_db(conn: sqlite3.Connection, cfg: Config | None = None) -> None:
    """Create the schema (idempotent), migrate it, and seed the pathogen table."""
    cfg = cfg or load_config()
    conn.executescript(SCHEMA)
    _apply_migrations(conn)
    conn.execute(
        "INSERT INTO schema_info(key, value) VALUES('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(SCHEMA_VERSION),),
    )
    for p in cfg.pathogens:
        conn.execute(
            """INSERT INTO pathogens(key, label, full_name, organism, tax_id)
               VALUES(?,?,?,?,?)
               ON CONFLICT(key) DO UPDATE SET
                   label=excluded.label, full_name=excluded.full_name,
                   organism=excluded.organism, tax_id=excluded.tax_id""",
            (p.key, p.label, p.full_name, p.organism, p.tax_id),
        )
    conn.commit()


# ------------------------------------------------------------------ helpers --
def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES(?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (key, json.dumps(value) if not isinstance(value, str) else value, utcnow()),
    )


def get_setting(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def record_source(conn: sqlite3.Connection, name: str, url: str | None,
                  record_count: int, source_version: str | None = None,
                  is_demo: bool = False, notes: str | None = None) -> int:
    cur = conn.execute(
        """INSERT INTO data_sources(name, url, source_version, retrieved_at,
                                    record_count, is_demo, notes)
           VALUES(?,?,?,?,?,?,?)""",
        (name, url, source_version, utcnow(), record_count, int(is_demo), notes),
    )
    return int(cur.lastrowid)


def fetch_df(conn: sqlite3.Connection, sql: str, params: Sequence[Any] = ()) -> "Any":
    """Run a query and return a pandas DataFrame (imported lazily)."""
    import pandas as pd

    rows = conn.execute(sql, params).fetchall()
    if not rows:
        # Preserve the column names even for an empty result so the dashboard
        # can render an empty table without special-casing.
        cur = conn.execute(sql, params)
        cols = [d[0] for d in cur.description] if cur.description else []
        return pd.DataFrame(columns=cols)
    return pd.DataFrame([dict(r) for r in rows])


def executemany(conn: sqlite3.Connection, sql: str, rows: Iterable[Sequence[Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    conn.executemany(sql, rows)
    return len(rows)


def table_count(conn: sqlite3.Connection, table: str, where: str = "", params: Sequence[Any] = ()) -> int:
    sql = f"SELECT COUNT(*) AS n FROM {table}"  # table names are internal constants
    if where:
        sql += f" WHERE {where}"
    row = conn.execute(sql, params).fetchone()
    return int(row["n"]) if row else 0
