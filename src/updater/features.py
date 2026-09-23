"""The features a new medicine is scored on — the production pipeline's, exactly.

``src/pipeline/process.py`` computes every fingerprint the published predictions
were made from: it re-parses the stored canonical SMILES and fingerprints that
molecule with the configured radius, bit count and chirality setting. The
worker must do the same, not something equivalent.

It used to fingerprint the in-memory molecule left over from standardisation
instead. For 7 of the 1,691 approved medicines that object differs from the
re-parsed SMILES in ways the Morgan fingerprint sees, so a new medicine of that
kind would have been scored on features the production path would never have
produced. This module is now the only way the worker turns a structure into
model input, and the known-answer self-test goes through it too.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from rdkit import Chem

from ..chemistry.descriptors import compute_descriptors
from ..chemistry.fingerprints import morgan_fingerprint


@dataclass(frozen=True)
class FeatureSettings:
    radius: int
    n_bits: int
    use_chirality: bool
    descriptor_limits: dict[str, Any]

    @classmethod
    def from_config(cls, cfg: Any) -> "FeatureSettings":
        fp_cfg = cfg.get("chemistry", "fingerprint", default={}) or {}
        return cls(
            radius=int(fp_cfg.get("radius", 2)),
            n_bits=int(fp_cfg.get("n_bits", 1024)),
            use_chirality=bool(fp_cfg.get("use_chirality", False)),
            descriptor_limits=cfg.get("chemistry", "descriptors", default={}) or {},
        )


def production_mol(canonical_smiles: str) -> Chem.Mol:
    """The molecule ``process.py`` fingerprints: the canonical SMILES, re-parsed."""
    mol = Chem.MolFromSmiles(canonical_smiles)
    if mol is None:
        raise ValueError("canonical SMILES failed to re-parse")
    return mol


def fingerprint_features(mol: Chem.Mol, settings: FeatureSettings) -> np.ndarray:
    """One row of model input, shaped and typed as the pipeline scores it."""
    fp = morgan_fingerprint(
        mol,
        radius=settings.radius,
        n_bits=settings.n_bits,
        use_chirality=settings.use_chirality,
    )
    return np.asarray(fp, dtype=np.float32).reshape(1, -1)


def featurise(canonical_smiles: str, settings: FeatureSettings) -> tuple[np.ndarray, dict]:
    """Model input and descriptors for a standardised structure."""
    mol = production_mol(canonical_smiles)
    descriptors = compute_descriptors(mol, lipinski_limits=settings.descriptor_limits)
    return fingerprint_features(mol, settings), descriptors
