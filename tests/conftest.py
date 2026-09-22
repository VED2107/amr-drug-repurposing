"""Shared fixtures.

Tests never touch the network or the project database. External services are
replaced with deterministic fakes so the suite is reproducible offline.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.config import load_config  # noqa: E402
from src.db import init_db, utcnow  # noqa: E402

from tests.helpers import SMILES, insert_bioactivity, insert_molecule  # noqa: F401

@pytest.fixture(scope="session")
def cfg():
    return load_config()


@pytest.fixture
def db(tmp_path, cfg) -> sqlite3.Connection:
    """A fresh, schema-initialised database per test."""
    conn = sqlite3.connect(str(tmp_path / "test.sqlite"))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn, cfg)
    yield conn
    conn.close()


@pytest.fixture
def populated_db(db, cfg):
    """A database with enough labelled data for one pathogen to be trainable.

    Structures are generated as real, distinct molecules (substituted benzoic
    acids and anilines) so scaffolds, fingerprints and descriptors are genuine
    rather than synthetic noise.
    """
    from rdkit import Chem

    pathogen = cfg.pathogens[0].key
    made = 0
    n_target = int(cfg.get("labeling", "min_records_per_pathogen", default=150)) + 40

    # Two scaffold families so a scaffold split has something to separate.
    templates = [
        "c1ccccc1C(=O)O",      # benzoic acid core
        "c1ccccc1N",           # aniline core
        "c1ccncc1C(=O)N",      # pyridine carboxamide core
        "C1CCCCC1C(=O)O",      # cyclohexane carboxylic acid core
    ]
    substituents = ["C", "CC", "CCC", "CCCC", "O", "OC", "OCC", "N", "NC", "F", "Cl", "Br",
                    "C(F)(F)F", "S", "SC", "C#N", "CO", "CCO", "C(C)C", "CCCCC"]

    idx = 0
    for template in templates:
        base = Chem.MolFromSmiles(template)
        for sub in substituents:
            for extra in ("", "C"):
                if made >= n_target:
                    break
                smiles = f"{extra}{sub}" + template if extra or sub else template
                candidate = Chem.MolFromSmiles(smiles)
                if candidate is None or candidate.GetNumHeavyAtoms() < 6:
                    idx += 1
                    continue
                try:
                    molecule_id = insert_molecule(
                        db, cfg, Chem.MolToSmiles(candidate), chembl_id=f"CHEMBL_T{idx}",
                        pref_name=f"test-compound-{idx}",
                    )
                except AssertionError:
                    idx += 1
                    continue
                # Alternate labels with a deterministic pattern that correlates
                # with the scaffold family, so a model has real signal to find.
                label = 1 if (templates.index(template) % 2 == 0) != (idx % 3 == 0) else 0
                insert_bioactivity(
                    db, molecule_id, pathogen, label=label,
                    pactivity=6.5 if label else 3.2, activity_id=f"act-{idx}",
                )
                made += 1
                idx += 1

    db.commit()
    return db
