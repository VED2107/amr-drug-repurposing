"""Molecular docking with AutoDock Vina.

A docking score is a computational estimate of binding affinity for a rigid
receptor and a flexible ligand. It is not proof of biological activity, and it
is not a measure of whether a drug works.
"""

from .receptor import ReceptorPreparationError, TargetSpec, load_targets, prepare_receptor
from .ligand import LigandPreparationError, prepare_ligand
from .vina_runner import VinaError, VinaResult, dock_ligand, vina_version

__all__ = [
    "ReceptorPreparationError",
    "TargetSpec",
    "load_targets",
    "prepare_receptor",
    "LigandPreparationError",
    "prepare_ligand",
    "VinaError",
    "VinaResult",
    "dock_ligand",
    "vina_version",
]
