"""Molecular processing: standardisation, fingerprints, descriptors, depiction."""

from __future__ import annotations

import numpy as np
import pytest
from rdkit import Chem

from src.chemistry import (
    compute_descriptors,
    fingerprint_array,
    fingerprint_from_blob,
    fingerprint_to_blob,
    lipinski_violations,
    molecule_id_for,
    morgan_fingerprint,
    standardize_smiles,
)
from src.chemistry.depict import mol_to_svg

from tests.helpers import SMILES


class TestStandardization:
    def test_valid_smiles_is_canonicalised(self):
        record = standardize_smiles(SMILES["aspirin"])
        assert record.is_valid
        assert record.canonical_smiles == "CC(=O)Oc1ccccc1C(=O)O"
        assert record.inchikey == "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"
        assert record.molecule_id == record.inchikey

    def test_canonicalisation_is_order_independent(self):
        """Two SMILES for one structure must produce one identity."""
        a = standardize_smiles("OC(=O)c1ccccc1OC(C)=O")
        b = standardize_smiles(SMILES["aspirin"])
        assert a.is_valid and b.is_valid
        assert a.molecule_id == b.molecule_id
        assert a.canonical_smiles == b.canonical_smiles

    def test_invalid_smiles_is_rejected_with_a_reason(self):
        record = standardize_smiles(SMILES["invalid"])
        assert not record.is_valid
        assert record.molecule_id is None
        assert "invalid smiles" in (record.error or "").lower()

    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_missing_smiles_is_rejected(self, value):
        record = standardize_smiles(value)
        assert not record.is_valid
        assert record.error == "missing SMILES"

    def test_salt_is_stripped_to_the_parent(self):
        record = standardize_smiles(SMILES["salt_form"])
        assert record.is_valid
        # The sodium counter-ion is gone; the parent drug identity is preserved.
        assert record.canonical_smiles == standardize_smiles(SMILES["aspirin"]).canonical_smiles

    def test_mixture_reduces_to_the_largest_fragment(self):
        record = standardize_smiles("CCCCCCCCO.CCO")
        assert record.is_valid
        assert record.canonical_smiles == "CCCCCCCCO"
        assert record.had_multiple_components

    def test_molecule_below_the_size_floor_is_rejected(self):
        record = standardize_smiles(SMILES["tiny"], min_heavy_atoms=5)
        assert not record.is_valid
        assert "too small" in record.error

    def test_molecule_above_the_size_ceiling_is_rejected(self):
        large = "C" * 200
        record = standardize_smiles(large, max_heavy_atoms=150)
        assert not record.is_valid
        assert "too large" in record.error

    def test_acyclic_molecules_share_one_scaffold_bucket(self):
        record = standardize_smiles("CCCCCCCCO")
        assert record.murcko_scaffold == "__acyclic__"

    def test_ring_system_yields_a_real_scaffold(self):
        record = standardize_smiles(SMILES["ciprofloxacin"])
        assert record.murcko_scaffold not in (None, "", "__acyclic__")
        assert Chem.MolFromSmiles(record.murcko_scaffold) is not None

    def test_enantiomers_share_one_scaffold(self):
        """A scaffold split must not be defeated by stereochemistry.

        Ketoconazole and levoketoconazole are the same chemistry to a Morgan
        fingerprint. If their scaffolds differed, one could be trained on while
        the other scored the test set.
        """
        racemic = standardize_smiles(
            "CC(=O)N1CCN(CC1)c1ccc(OCC2COC(Cn3ccnc3)(O2)c2ccc(Cl)cc2Cl)cc1"
        )
        single_enantiomer = standardize_smiles(
            "CC(=O)N1CCN(CC1)c1ccc(OC[C@@H]2CO[C@](Cn3ccnc3)(O2)c2ccc(Cl)cc2Cl)cc1"
        )
        assert racemic.is_valid and single_enantiomer.is_valid
        assert racemic.murcko_scaffold == single_enantiomer.murcko_scaffold

    def test_scaffold_carries_no_stereochemistry(self):
        record = standardize_smiles("C[C@H]1CCC[C@@H](C)C1c1ccccc1")
        assert record.murcko_scaffold not in (None, "", "__acyclic__")
        assert "@" not in record.murcko_scaffold

    def test_molecule_id_falls_back_to_a_smiles_hash(self):
        mid = molecule_id_for(None, "CCO")
        assert mid.startswith("SMI-")
        # The fallback must be deterministic, or identities would drift.
        assert mid == molecule_id_for(None, "CCO")

    def test_molecule_id_requires_some_identifier(self):
        with pytest.raises(Exception):
            molecule_id_for(None, None)


class TestFingerprints:
    def test_dimension_is_1024_as_the_project_specifies(self):
        mol = Chem.MolFromSmiles(SMILES["trimethoprim"])
        fp = morgan_fingerprint(mol)
        assert fp.shape == (1024,)
        assert set(np.unique(fp)).issubset({0, 1})

    def test_fingerprint_is_deterministic(self):
        mol = Chem.MolFromSmiles(SMILES["ciprofloxacin"])
        assert np.array_equal(morgan_fingerprint(mol), morgan_fingerprint(mol))

    def test_different_molecules_give_different_fingerprints(self):
        a = morgan_fingerprint(Chem.MolFromSmiles(SMILES["aspirin"]))
        b = morgan_fingerprint(Chem.MolFromSmiles(SMILES["metformin"]))
        assert not np.array_equal(a, b)

    def test_blob_round_trip_is_lossless(self):
        fp = morgan_fingerprint(Chem.MolFromSmiles(SMILES["naproxen"]))
        blob = fingerprint_to_blob(fp)
        assert len(blob) == 128  # 1024 bits packed
        assert np.array_equal(fp, fingerprint_from_blob(blob))

    def test_stacking_blobs_produces_a_feature_matrix(self):
        blobs = [
            fingerprint_to_blob(morgan_fingerprint(Chem.MolFromSmiles(s)))
            for s in (SMILES["aspirin"], SMILES["caffeine"], SMILES["isoniazid"])
        ]
        matrix = fingerprint_array(blobs)
        assert matrix.shape == (3, 1024)

    def test_empty_blob_list_gives_an_empty_matrix(self):
        assert fingerprint_array([]).shape == (0, 1024)

    def test_none_molecule_raises(self):
        with pytest.raises(ValueError):
            morgan_fingerprint(None)

    def test_truncated_blob_raises_rather_than_padding(self):
        with pytest.raises(ValueError):
            fingerprint_from_blob(b"\x00" * 4)


class TestDescriptors:
    def test_known_values_for_aspirin(self):
        desc = compute_descriptors(Chem.MolFromSmiles(SMILES["aspirin"]))
        assert desc["mw"] == pytest.approx(180.16, abs=0.05)
        assert desc["hbd"] == 1
        assert desc["hba"] == 3
        assert desc["lipinski_violations"] == 0

    def test_all_expected_keys_are_present(self):
        desc = compute_descriptors(Chem.MolFromSmiles(SMILES["caffeine"]))
        for key in ("mw", "logp", "tpsa", "hbd", "hba", "rotatable_bonds",
                    "aromatic_rings", "heavy_atoms", "qed", "lipinski_violations"):
            assert key in desc

    def test_lipinski_counts_each_broken_rule(self):
        assert lipinski_violations(200, 2.0, 1, 3) == 0
        assert lipinski_violations(600, 2.0, 1, 3) == 1
        assert lipinski_violations(600, 6.0, 1, 3) == 2
        assert lipinski_violations(600, 6.0, 9, 14) == 4

    def test_none_molecule_raises(self):
        with pytest.raises(ValueError):
            compute_descriptors(None)


class TestDepiction:
    def test_valid_structure_renders_svg(self):
        svg = mol_to_svg(SMILES["trimethoprim"])
        assert svg and svg.lstrip().startswith("<?xml") or "<svg" in svg

    def test_invalid_structure_returns_none_instead_of_raising(self):
        assert mol_to_svg(SMILES["invalid"]) is None
        assert mol_to_svg(None) is None
