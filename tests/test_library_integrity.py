"""Integrity of the approved-medicine library in the research database.

These read ``data/amr.sqlite`` itself (read-only) and are skipped when it is
absent. They pin the corrections from the 2026-09-29 audit: each approved
ingredient resolves to its own structure, the broad molecular dataset stays
distinct from the library, and every library medicine carries exactly one
current prediction per pathogen and one antibacterial classification.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

DB = Path(__file__).resolve().parents[1] / "data" / "amr.sqlite"

pytestmark = pytest.mark.skipif(not DB.exists(), reason="research database not present")

ACTIVE = "JOIN model_versions m ON m.model_version = p.model_version AND m.status = 'ACTIVE'"


@pytest.fixture(scope="module")
def conn():
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    yield c
    c.close()


def one(conn, sql, *params):
    return conn.execute(sql, params).fetchone()[0]


def test_molecular_dataset_and_library_are_distinct_populations(conn):
    molecules = one(conn, "SELECT COUNT(*) FROM molecules WHERE is_valid")
    library = one(conn, "SELECT COUNT(DISTINCT molecule_id) FROM drugs WHERE molecule_id IS NOT NULL")
    assert molecules >= 20_000, "the broad molecular dataset is kept"
    assert 1_000 < library < 3_000, "the approved-medicine library is its own, smaller population"
    assert library < molecules


@pytest.mark.parametrize("ingredient, expected_name", [
    ("HYDROCORTISONE", "HYDROCORTISONE"),
    ("HYDROCORTISONE ACETATE", "HYDROCORTISONE ACETATE"),
    ("TESTOSTERONE", "TESTOSTERONE"),
    ("TESTOSTERONE PROPIONATE", "TESTOSTERONE PROPIONATE"),
    ("CEFAZOLIN SODIUM", "CEFAZOLIN"),
    ("IMIPRAMINE PAMOATE", "IMIPRAMINE"),
])
def test_known_wrong_mappings_are_corrected(conn, ingredient, expected_name):
    rows = conn.execute(
        """SELECT DISTINCT m.pref_name FROM drugs d JOIN molecules m ON m.molecule_id = d.molecule_id
            WHERE d.generic_name = ?""",
        (ingredient,),
    ).fetchall()
    assert rows == [(expected_name,)], f"{ingredient} must resolve to {expected_name}, got {rows}"


def test_esters_and_parents_stay_distinct(conn):
    a = one(conn, "SELECT molecule_id FROM drugs WHERE generic_name = 'HYDROCORTISONE' LIMIT 1")
    b = one(conn, "SELECT molecule_id FROM drugs WHERE generic_name = 'HYDROCORTISONE ACETATE' LIMIT 1")
    assert a and b and a != b


@pytest.mark.parametrize("ingredient", ["SODIUM CHLORIDE", "POTASSIUM CHLORIDE", "SODIUM NITROPRUSSIDE"])
def test_sodium_and_inorganic_products_do_not_borrow_a_structure(conn, ingredient):
    assert one(conn, "SELECT COUNT(*) FROM drugs WHERE generic_name = ? AND molecule_id IS NOT NULL", ingredient) == 0


def test_every_library_structure_is_valid_and_organic(conn):
    from rdkit import Chem

    rows = conn.execute(
        """SELECT m.molecule_id, m.is_valid, m.canonical_smiles FROM molecules m
            WHERE m.molecule_id IN (SELECT molecule_id FROM drugs)"""
    ).fetchall()
    for molecule_id, valid, smiles in rows:
        assert valid, molecule_id
        mol = Chem.MolFromSmiles(smiles)
        assert mol is not None and any(a.GetAtomicNum() == 6 for a in mol.GetAtoms()), molecule_id


def test_one_current_prediction_per_library_medicine_and_pathogen(conn):
    bad = one(conn, f"""
        SELECT COUNT(*) FROM (
          SELECT d.molecule_id FROM (SELECT DISTINCT molecule_id FROM drugs WHERE molecule_id IS NOT NULL) d
          LEFT JOIN predictions p ON p.molecule_id = d.molecule_id
          LEFT JOIN model_versions m ON m.model_version = p.model_version AND m.status = 'ACTIVE'
          GROUP BY d.molecule_id
          HAVING COUNT(DISTINCT CASE WHEN m.model_version IS NOT NULL THEN p.pathogen_key END) <> 4
             OR SUM(CASE WHEN m.model_version IS NOT NULL THEN 1 ELSE 0 END) <> 4)""")
    assert bad == 0, "each library medicine has exactly four ACTIVE predictions"


def test_every_library_medicine_is_classified(conn):
    library = one(conn, "SELECT COUNT(DISTINCT molecule_id) FROM drugs WHERE molecule_id IS NOT NULL")
    classified = one(conn, """SELECT COUNT(*) FROM medicine_use_status
                              WHERE molecule_id IN (SELECT molecule_id FROM drugs)""")
    assert classified == library
    flags = {r[0] for r in conn.execute("SELECT DISTINCT is_antibacterial FROM medicine_use_status")}
    assert flags <= {"true", "false", "unclassified"}
    assert one(conn, """SELECT COUNT(*) FROM medicine_use_status
                        WHERE (status = 'antibacterial') <> (is_antibacterial = 'true')""") == 0
    assert one(conn, """SELECT COUNT(*) FROM medicine_use_status
                        WHERE status = 'unclassified' AND is_antibacterial <> 'unclassified'""") == 0


@pytest.mark.parametrize("name", ["DOXYCYCLINE", "LEVOFLOXACIN", "CEPHALEXIN", "CIPROFLOXACIN", "RIFAMPIN"])
def test_known_antibacterials_are_classified_as_such(conn, name):
    status = one(conn, """SELECT us.status FROM medicine_use_status us
                          JOIN drugs d ON d.molecule_id = us.molecule_id
                          WHERE d.generic_name = ? LIMIT 1""", name)
    assert status == "antibacterial", name


def test_repurposing_candidates_count_distinct_medicines(conn):
    base = f"""SELECT DISTINCT p.molecule_id FROM predictions p {ACTIVE}
               WHERE p.probability >= 0.4 AND p.molecule_id IN (SELECT molecule_id FROM drugs)
                 AND p.molecule_id IN (SELECT molecule_id FROM molecules WHERE is_valid)
                 AND p.molecule_id NOT IN (SELECT molecule_id FROM medicine_use_status
                                            WHERE status = 'antibacterial')"""
    overall = one(conn, f"SELECT COUNT(*) FROM ({base})")
    per = [one(conn, f"{base.replace('SELECT DISTINCT', 'SELECT COUNT(DISTINCT', 1).replace('p.molecule_id FROM', 'p.molecule_id) FROM', 1)} AND p.pathogen_key = ?", k)
           for k in ("mrsa", "ecoli", "kpneumoniae", "mtb")]
    assert max(per) <= overall <= sum(per)
    antibacterial_in = one(conn, f"""SELECT COUNT(*) FROM ({base}) c
                                     JOIN medicine_use_status us ON us.molecule_id = c.molecule_id
                                     WHERE us.status = 'antibacterial'""")
    assert antibacterial_in == 0
