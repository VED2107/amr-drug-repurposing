"""Physicochemical descriptors and drug-likeness.

These are COMPUTATIONAL properties. Passing Lipinski's rule of five says a
molecule is orally drug-like in silico. It says nothing about safety, and this
module never produces a safe/unsafe verdict.
"""

from __future__ import annotations

from typing import Any

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, QED, rdMolDescriptors


def lipinski_violations(
    mw: float,
    logp: float,
    hbd: int,
    hba: int,
    *,
    mw_max: float = 500.0,
    logp_max: float = 5.0,
    hbd_max: int = 5,
    hba_max: int = 10,
) -> int:
    """Count Lipinski rule-of-five violations (0-4). Lower is more drug-like."""
    return sum(
        [
            mw > mw_max,
            logp > logp_max,
            hbd > hbd_max,
            hba > hba_max,
        ]
    )


def compute_descriptors(mol: Chem.Mol, *, lipinski_limits: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compute the descriptor set displayed on the drug details page.

    Individual descriptor failures are tolerated: the value comes back as None
    and the rest of the record is still usable.
    """
    if mol is None:
        raise ValueError("cannot compute descriptors for a None molecule")

    limits = lipinski_limits or {}

    def safe(fn, default=None):
        try:
            return fn()
        except Exception:
            return default

    mw = safe(lambda: float(Descriptors.MolWt(mol)))
    logp = safe(lambda: float(Crippen.MolLogP(mol)))
    tpsa = safe(lambda: float(rdMolDescriptors.CalcTPSA(mol)))
    hbd = safe(lambda: int(Lipinski.NumHDonors(mol)))
    hba = safe(lambda: int(Lipinski.NumHAcceptors(mol)))
    rotb = safe(lambda: int(Lipinski.NumRotatableBonds(mol)))
    arom = safe(lambda: int(rdMolDescriptors.CalcNumAromaticRings(mol)))
    heavy = safe(lambda: int(mol.GetNumHeavyAtoms()))
    csp3 = safe(lambda: float(rdMolDescriptors.CalcFractionCSP3(mol)))
    qed = safe(lambda: float(QED.qed(mol)))

    violations = None
    if None not in (mw, logp, hbd, hba):
        violations = lipinski_violations(
            mw, logp, hbd, hba,
            mw_max=float(limits.get("lipinski_mw_max", 500.0)),
            logp_max=float(limits.get("lipinski_logp_max", 5.0)),
            hbd_max=int(limits.get("lipinski_hbd_max", 5)),
            hba_max=int(limits.get("lipinski_hba_max", 10)),
        )

    return {
        "mw": mw,
        "logp": logp,
        "tpsa": tpsa,
        "hbd": hbd,
        "hba": hba,
        "rotatable_bonds": rotb,
        "aromatic_rings": arom,
        "heavy_atoms": heavy,
        "fraction_csp3": csp3,
        "qed": qed,
        "lipinski_violations": violations,
    }


DESCRIPTOR_LABELS = {
    "mw": ("Molecular weight", "Da"),
    "logp": ("LogP (Crippen)", ""),
    "tpsa": ("TPSA", "A^2"),
    "hbd": ("H-bond donors", ""),
    "hba": ("H-bond acceptors", ""),
    "rotatable_bonds": ("Rotatable bonds", ""),
    "aromatic_rings": ("Aromatic rings", ""),
    "heavy_atoms": ("Heavy atoms", ""),
    "fraction_csp3": ("Fraction Csp3", ""),
    "qed": ("QED drug-likeness", ""),
    "lipinski_violations": ("Lipinski violations", ""),
}
