"""Tests for the containerised update worker.

The important one is :func:`test_worker_path_reproduces_published_predictions`.
Everything else checks plumbing; that test checks the only thing that would
actually matter if it were wrong — that the fingerprint and model call inside
the container produce the same numbers as the pipeline that published the
database. A worker that silently computed slightly different features would put
plausible, wrong values next to real ones.

Nothing here contacts Supabase or the network. The database-facing behaviour is
asserted against the SQL the store emits, not against a live connection.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = REPO_ROOT / "models"
DB_PATH = REPO_ROOT / "data" / "amr.sqlite"

PRODUCTION_MODELS = {
    "mrsa": "RF-mrsa-v4",
    "ecoli": "RF-ecoli-v4",
    "kpneumoniae": "RF-kpneumoniae-v5",
    "mtb": "RF-mtb-v5",
}


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def test_missing_database_url_is_refused(monkeypatch):
    """A worker with nowhere to publish stops before touching a source."""
    from src.updater.config import ConfigurationError, load_updater_config

    for name in ("AMR_DATABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL"):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(ConfigurationError) as excinfo:
        load_updater_config()
    assert "connection string" in str(excinfo.value)


def test_missing_models_directory_is_refused(monkeypatch, tmp_path):
    from src.updater.config import ConfigurationError, load_updater_config

    monkeypatch.setenv("AMR_DATABASE_URL", "postgresql://example/db")
    monkeypatch.setenv("AMR_MODELS_DIR", str(tmp_path / "absent"))

    with pytest.raises(ConfigurationError) as excinfo:
        load_updater_config()
    assert "models directory" in str(excinfo.value)


def test_config_never_reveals_the_connection_string(monkeypatch, tmp_path):
    """The summary written to the log must not carry a credential."""
    from src.updater.config import load_updater_config

    secret = "postgresql://user:hunter2@db.example.com:5432/postgres"
    monkeypatch.setenv("AMR_DATABASE_URL", secret)
    monkeypatch.setenv("AMR_MODELS_DIR", str(tmp_path))

    config = load_updater_config()
    described = config.describe()
    assert "hunter2" not in described
    assert secret not in described
    assert config.database_url == secret


# --------------------------------------------------------------------------
# Model loading
# --------------------------------------------------------------------------


@pytest.mark.skipif(not MODELS_DIR.exists(), reason="model artifacts are not present")
def test_windows_artifact_path_resolves_inside_a_container(tmp_path):
    """The registry records a Windows path; the worker must still find the file."""
    from src.updater.models import resolve_artifact
    from src.updater.store import ActiveModel

    artifact = tmp_path / "RF-mrsa-v4.joblib"
    artifact.write_bytes(b"not a real model")

    meta = ActiveModel(
        pathogen_key="mrsa",
        model_version="RF-mrsa-v4",
        model_type="random_forest",
        dataset_version="DS-x",
        feature_version="morgan-r2-1024-v1",
        artifact_path=r"C:\PROJECTS\AMR\models\RF-mrsa-v4.joblib",
    )

    assert resolve_artifact(meta, tmp_path) == artifact


def test_unresolvable_artifact_says_where_it_looked(tmp_path):
    from src.updater.config import ConfigurationError
    from src.updater.models import resolve_artifact
    from src.updater.store import ActiveModel

    meta = ActiveModel("mrsa", "RF-mrsa-v9", "random_forest", None, None, None)

    with pytest.raises(ConfigurationError) as excinfo:
        resolve_artifact(meta, tmp_path)
    assert "RF-mrsa-v9" in str(excinfo.value)


def test_a_changed_active_model_stops_the_run():
    """Promotion without review must not be scored over silently."""
    from src.updater.models import LoadedModel, ModelIntegrityError, verify_expected
    from src.updater.store import ActiveModel

    loaded = {
        pathogen: LoadedModel(
            meta=ActiveModel(pathogen, version, "random_forest", None, None, None),
            estimator=object(),
            n_features=1024,
            artifact=Path(version),
        )
        for pathogen, version in PRODUCTION_MODELS.items()
    }

    verify_expected(loaded)  # the expected four: no complaint

    loaded["mtb"] = LoadedModel(
        meta=ActiveModel("mtb", "RF-mtb-v6", "random_forest", None, None, None),
        estimator=object(),
        n_features=1024,
        artifact=Path("RF-mtb-v6"),
    )
    with pytest.raises(ModelIntegrityError) as excinfo:
        verify_expected(loaded)
    assert "RF-mtb-v6" in str(excinfo.value)


@pytest.mark.skipif(not MODELS_DIR.exists(), reason="model artifacts are not present")
def test_all_four_production_models_load_and_infer():
    """Each production artifact loads and scores a fingerprint."""
    import joblib

    from src.chemistry.fingerprints import morgan_fingerprint
    from src.ml import models as zoo
    from rdkit import Chem

    mol = Chem.MolFromSmiles("CC(=O)Oc1ccccc1C(=O)O")
    features = np.asarray(morgan_fingerprint(mol), dtype=np.float32).reshape(1, -1)

    for pathogen, version in PRODUCTION_MODELS.items():
        artifact = MODELS_DIR / f"{version}.joblib"
        if not artifact.exists():
            pytest.skip(f"{version} is not present")
        bundle = joblib.load(artifact)
        probability = float(zoo.predict_proba(bundle["model"], features)[0])
        assert 0.0 <= probability <= 1.0, f"{version} produced {probability}"


# --------------------------------------------------------------------------
# Scientific integrity — the test that matters
# --------------------------------------------------------------------------


@pytest.mark.skipif(
    not DB_PATH.exists() or not MODELS_DIR.exists(),
    reason="needs the research database and the model artifacts",
)
def test_worker_path_reproduces_published_predictions():
    """The worker's features and inference must match what was published.

    Any drift here — a different radius, a different bit count, chirality on
    instead of off — would produce numbers that look reasonable and are not the
    ones the rest of the site is built on.
    """
    import joblib

    from src.chemistry.fingerprints import morgan_fingerprint
    from src.ml import models as zoo
    from rdkit import Chem

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        actives = {
            row["pathogen_key"]: row
            for row in conn.execute(
                "select pathogen_key, model_version, artifact_path "
                "from model_versions where status = 'ACTIVE'"
            )
        }
        assert actives, "no ACTIVE models in the research database"

        molecules = conn.execute(
            """
            select m.molecule_id, m.canonical_smiles
              from molecules m
              join drugs d on d.molecule_id = m.molecule_id
             where m.is_valid = 1 and m.canonical_smiles is not null
             group by m.molecule_id
             limit 5
            """
        ).fetchall()
        assert molecules, "no approved molecules to check against"

        compared = 0
        for pathogen, meta in actives.items():
            name = meta["artifact_path"].replace("\\", "/").split("/")[-1]
            artifact = MODELS_DIR / name
            if not artifact.exists():
                continue

            bundle = joblib.load(artifact)
            model = bundle["model"]
            n_bits = int(bundle.get("n_features", 1024))

            for row in molecules:
                published = conn.execute(
                    "select probability from predictions "
                    "where molecule_id = ? and pathogen_key = ? and model_version = ?",
                    (row["molecule_id"], pathogen, meta["model_version"]),
                ).fetchone()
                if published is None:
                    continue

                mol = Chem.MolFromSmiles(row["canonical_smiles"])
                features = np.asarray(
                    morgan_fingerprint(mol, radius=2, n_bits=n_bits), dtype=np.float32
                ).reshape(1, -1)
                recomputed = float(zoo.predict_proba(model, features)[0])

                assert recomputed == pytest.approx(published["probability"], abs=1e-9), (
                    f"{row['molecule_id']} / {pathogen}: published "
                    f"{published['probability']}, worker path {recomputed}"
                )
                compared += 1

        assert compared > 0, "no published prediction was available to compare against"
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Honesty rules
# --------------------------------------------------------------------------


def test_a_molecule_without_a_structure_is_skipped_not_invented():
    """No SMILES means no medicine — never a placeholder structure."""
    from src.chemistry.standardize import standardize_smiles

    for empty in ("", "   ", "not-a-smiles"):
        record = standardize_smiles(empty)
        assert not record.is_valid
        assert record.molecule_id is None or record.canonical_smiles is None


def test_only_the_four_supported_pathogens_can_be_scored():
    from src.updater.config import SUPPORTED_PATHOGENS

    assert set(SUPPORTED_PATHOGENS) == set(PRODUCTION_MODELS)
    for unsupported in ("pseudomonas", "candida", "covid", "cancer"):
        assert unsupported not in SUPPORTED_PATHOGENS


def test_the_worker_never_imports_training_code():
    """Structural guarantee that a run cannot retrain anything.

    Parsed rather than grepped: the modules *discuss* training in their
    docstrings precisely because they must not do it, and a text search cannot
    tell an explanation from a call.
    """
    import ast

    worker_modules = sorted((REPO_ROOT / "src" / "updater").glob("*.py"))
    assert worker_modules, "no worker modules found"

    training_modules = {"train", "splits", "labeling", "dataset", "evaluate", "registry"}
    forbidden_calls = {"fit", "fit_transform", "partial_fit", "promote",
                       "next_model_version", "train_model"}

    for path in worker_modules:
        tree = ast.parse(path.read_text(encoding="utf8"), filename=str(path))

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                tail = node.module.rsplit(".", 1)[-1]
                assert tail not in training_modules, (
                    f"{path.name} imports {node.module}; the worker performs inference only"
                )
                for alias in node.names:
                    assert alias.name not in training_modules, (
                        f"{path.name} imports {alias.name} from {node.module}"
                    )

            if isinstance(node, ast.Call):
                func = node.func
                name = getattr(func, "attr", None) or getattr(func, "id", None)
                assert name not in forbidden_calls, (
                    f"{path.name} calls {name}() at line {node.lineno}; "
                    "the worker must not train or promote a model"
                )


def test_predictions_are_written_with_conflict_do_nothing():
    """Re-running must not duplicate or churn an existing prediction."""
    source = (REPO_ROOT / "src" / "updater" / "store.py").read_text(encoding="utf8")
    assert "on conflict (molecule_id, pathogen_key, model_version) do nothing" in source
    assert "on conflict (molecule_id) do update" in source  # molecules are refreshed
    assert "on conflict (drug_id) do update" in source


def test_store_writes_no_table_outside_the_published_schema():
    """The worker must not invent a parallel place to keep its state."""
    import re

    source = (REPO_ROOT / "src" / "updater" / "store.py").read_text(encoding="utf8")
    # In an UPDATE the SET clause sits on the following line, so the table name
    # is the word after the keyword — not the last word on the line, which is
    # how an earlier version of this test managed to "find" a table called SET.
    written = set(re.findall(r"insert\s+into\s+(\w+)", source)) | set(
        re.findall(r"\bupdate\s+(\w+)\s*\n\s*set\b", source)
    )
    allowed = {
        "molecules", "drugs", "predictions",
        "pipeline_runs", "pipeline_errors", "data_sources",
    }
    assert written <= allowed, f"unexpected table(s): {sorted(written - allowed)}"

    for forbidden in ("insert into model_versions", "insert into dataset_",
                      "insert into bioactivity", "update model_versions"):
        assert forbidden not in source
