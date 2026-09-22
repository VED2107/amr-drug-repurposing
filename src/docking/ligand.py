"""Ligand preparation: SMILES -> 3D conformer -> PDBQT.

Conformer generation uses ETKDGv3 with a fixed seed so a rerun produces the same
starting geometry and therefore reproducible docking input.
"""

from __future__ import annotations

from pathlib import Path

from meeko import MoleculePreparation, PDBQTWriterLegacy
from rdkit import Chem
from rdkit.Chem import AllChem

from ..logging_utils import get_logger

log = get_logger("amr.docking.ligand")


class LigandPreparationError(RuntimeError):
    """Raised when a ligand cannot be turned into a dockable PDBQT."""


def prepare_ligand(
    smiles: str,
    out_path: Path,
    *,
    seed: int = 42,
    max_embed_attempts: int = 3,
    optimize: bool = True,
) -> Path:
    """Write a docking-ready PDBQT for one SMILES string."""
    if not smiles or not str(smiles).strip():
        raise LigandPreparationError("empty SMILES")

    mol = Chem.MolFromSmiles(str(smiles).strip())
    if mol is None:
        raise LigandPreparationError(f"RDKit could not parse SMILES: {smiles!r}")

    mol = Chem.AddHs(mol)

    embedded = False
    for attempt in range(max_embed_attempts):
        params = AllChem.ETKDGv3()
        params.randomSeed = seed + attempt
        params.useRandomCoords = attempt > 0  # fall back for strained systems
        if AllChem.EmbedMolecule(mol, params) == 0:
            embedded = True
            break
    if not embedded:
        raise LigandPreparationError(
            f"3D embedding failed after {max_embed_attempts} attempts for {smiles!r}"
        )

    if optimize:
        try:
            # MMFF is preferred; UFF covers atom types MMFF does not parameterise.
            if AllChem.MMFFHasAllMoleculeParams(mol):
                AllChem.MMFFOptimizeMolecule(mol, maxIters=500)
            else:
                AllChem.UFFOptimizeMolecule(mol, maxIters=500)
        except Exception as exc:
            log.debug("force-field optimisation skipped for %s: %s", smiles, exc)

    try:
        setups = MoleculePreparation().prepare(mol)
    except Exception as exc:
        raise LigandPreparationError(f"Meeko preparation failed: {type(exc).__name__}: {exc}") from exc
    if not setups:
        raise LigandPreparationError("Meeko produced no molecule setup")

    pdbqt, ok, error = PDBQTWriterLegacy.write_string(setups[0])
    if not ok:
        raise LigandPreparationError(f"PDBQT writing failed: {error}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(pdbqt, encoding="utf-8")
    return out_path
