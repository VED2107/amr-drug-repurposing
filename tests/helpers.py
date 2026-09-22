"""Shared constants and database helpers for the test suite."""

from __future__ import annotations

import sqlite3

from src.db import utcnow

# Real structures used throughout the suite. Each is a well-known approved drug.
SMILES = {
    "aspirin": "CC(=O)Oc1ccccc1C(=O)O",
    "trimethoprim": "COc1cc(Cc2cnc(N)nc2N)cc(OC)c1OC",
    "ciprofloxacin": "O=C(O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O",
    "isoniazid": "NNC(=O)c1ccncc1",
    "paracetamol": "CC(=O)Nc1ccc(O)cc1",
    "ibuprofen": "CC(C)Cc1ccc(C(C)C(=O)O)cc1",
    "metformin": "CN(C)C(=N)NC(N)=N",
    "caffeine": "Cn1c(=O)c2c(ncn2C)n(C)c1=O",
    "naproxen": "COc1ccc2cc(C(C)C(=O)O)ccc2c1",
    "salt_form": "CC(=O)Oc1ccccc1C(=O)O.[Na+]",
    "mixture": "CCO.CCCO",
    "invalid": "not-a-molecule",
    "tiny": "C",
}

# Fourteen distinct ring systems, each with one attachment point. Distinct
# Murcko scaffolds are what makes a scaffold-aware split meaningful in tests.
_CORES = [
    "c1ccc({s})cc1",                 # benzene
    "c1ccc({s})cn1",                 # pyridine
    "c1cc({s})ccn1",                 # pyridine, other position
    "c1ccc({s})s1",                  # thiophene
    "c1ccc({s})o1",                  # furan
    "c1cc({s})[nH]n1",               # pyrazole
    "c1cnc({s})[nH]1",               # imidazole
    "c1csc({s})n1",                  # thiazole
    "c1ccc2cc({s})ccc2c1",           # naphthalene
    "c1ccc2nccc({s})c2c1",           # quinoline
    "c1ccc2[nH]cc({s})c2c1",         # indole
    "C1CCN({s})CC1",                 # piperidine
    "C1CCC({s})CC1",                 # cyclohexane
    "c1ccc(-c2ccc({s})cc2)cc1",      # biphenyl
]

# The label is carried by the substituent class, not by the ring. A model must
# therefore learn a substructural rule that transfers to unseen scaffolds,
# which is exactly what the scaffold split is meant to measure.
_ACTIVE_SUBSTITUENTS = [
    "C(=O)O", "CC(=O)O", "OCC(=O)O", "C(=O)N", "CC(=O)N",
    "S(N)(=O)=O", "C(=O)NO", "NC(=O)C", "CCN", "CN",
]
_INACTIVE_SUBSTITUENTS = [
    "C", "CC", "CCC", "CCCC", "CCCCC",
    "F", "Cl", "Br", "C(C)(C)C", "Cc1ccccc1",
]


def generate_series(limit: int = 280) -> list[tuple[str, int]]:
    """Deterministic (SMILES, label) pairs spanning fourteen real scaffolds.

    Actives carry a polar/acidic head group, inactives a lipophilic one. Every
    structure is parsed and canonicalised before it is returned, so the suite
    never trains on chemistry that RDKit would reject.
    """
    from rdkit import Chem

    out: list[tuple[str, int]] = []
    seen: set[str] = set()

    for core in _CORES:
        for label, substituents in ((1, _ACTIVE_SUBSTITUENTS), (0, _INACTIVE_SUBSTITUENTS)):
            for sub in substituents:
                mol = Chem.MolFromSmiles(core.format(s=sub))
                if mol is None:
                    continue
                canonical = Chem.MolToSmiles(mol)
                if canonical in seen:
                    continue
                seen.add(canonical)
                out.append((canonical, label))
                if len(out) >= limit:
                    return out
    return out


def insert_molecule(
    conn: sqlite3.Connection, cfg, smiles: str, *, chembl_id: str | None = None,
    pref_name: str | None = None,
) -> str:
    """Standardise, fingerprint and store one molecule. Returns the molecule id."""
    from rdkit import Chem

    from src.chemistry import (
        compute_descriptors,
        fingerprint_to_blob,
        morgan_fingerprint,
        standardize_smiles,
    )

    record = standardize_smiles(smiles)
    assert record.is_valid, f"fixture SMILES failed to standardise: {record.error}"

    mol = Chem.MolFromSmiles(record.canonical_smiles)
    fp = fingerprint_to_blob(morgan_fingerprint(mol))
    desc = compute_descriptors(mol)

    conn.execute(
        """INSERT INTO molecules(molecule_id, chembl_id, pref_name, input_smiles,
               canonical_smiles, inchi, inchikey, murcko_scaffold, heavy_atoms,
               mw, logp, tpsa, hbd, hba, rotatable_bonds, lipinski_violations, qed,
               fingerprint, feature_version, is_valid, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
           ON CONFLICT(molecule_id) DO NOTHING""",
        (
            record.molecule_id, chembl_id, pref_name, smiles, record.canonical_smiles,
            record.inchi, record.inchikey, record.murcko_scaffold, record.heavy_atoms,
            desc["mw"], desc["logp"], desc["tpsa"], desc["hbd"], desc["hba"],
            desc["rotatable_bonds"], desc["lipinski_violations"], desc["qed"],
            fp, cfg.get("ml", "feature_version"), utcnow(), utcnow(),
        ),
    )
    conn.commit()
    return record.molecule_id


def insert_bioactivity(
    conn: sqlite3.Connection, molecule_id: str, pathogen_key: str, *,
    label: int, pactivity: float = 6.0, activity_id: str | None = None,
) -> None:
    conn.execute(
        """INSERT INTO bioactivity(source_activity_id, source, molecule_id, pathogen_key,
               activity_type, activity_value, activity_units, activity_relation,
               pactivity, pactivity_method, label, label_reason, created_at)
           VALUES(?,'test',?,?,'MIC',1.0,'ug.mL-1','=',?,'test',?,'fixture',?)""",
        (
            activity_id or f"{molecule_id}-{pathogen_key}-{label}-{pactivity}",
            molecule_id, pathogen_key, pactivity, label, utcnow(),
        ),
    )
    conn.commit()


