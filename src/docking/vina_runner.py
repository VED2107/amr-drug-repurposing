"""AutoDock Vina execution and output parsing."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from ..config import Config
from ..logging_utils import get_logger

log = get_logger("amr.docking.vina")

# "   1       -7.646          0          0"
_MODE_LINE = re.compile(r"^\s*(\d+)\s+(-?\d+\.\d+)\s+(\S+)\s+(\S+)\s*$")


class VinaError(RuntimeError):
    """Raised when Vina cannot be run or its output cannot be parsed."""


@dataclass
class Pose:
    rank: int
    score_kcal_mol: float
    rmsd_lb: float | None
    rmsd_ub: float | None


@dataclass
class VinaResult:
    poses: list[Pose] = field(default_factory=list)
    out_path: Path | None = None
    stdout: str = ""

    @property
    def best_score(self) -> float | None:
        return self.poses[0].score_kcal_mol if self.poses else None


def vina_version(binary: Path) -> str:
    """Return the Vina version string, for provenance."""
    try:
        proc = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=60)
        first = (proc.stdout or proc.stderr or "").strip().splitlines()
        return first[0].strip() if first else "unknown"
    except Exception as exc:
        return f"unknown ({type(exc).__name__})"


def parse_vina_output(stdout: str) -> list[Pose]:
    """Extract the pose table from Vina stdout."""
    poses: list[Pose] = []
    for line in stdout.splitlines():
        match = _MODE_LINE.match(line)
        if not match:
            continue
        rank, score, lb, ub = match.groups()

        def num(value: str) -> float | None:
            try:
                return float(value)
            except ValueError:
                return None

        poses.append(Pose(int(rank), float(score), num(lb), num(ub)))
    return poses


def dock_ligand(
    cfg: Config,
    *,
    binary: Path,
    receptor_pdbqt: Path,
    ligand_pdbqt: Path,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    out_path: Path,
    timeout_seconds: int = 1800,
) -> VinaResult:
    """Dock one ligand into one receptor. Raises VinaError on failure."""
    dock_cfg = cfg.get("docking", default={}) or {}
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(binary),
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(ligand_pdbqt),
        "--center_x", f"{center[0]:.3f}",
        "--center_y", f"{center[1]:.3f}",
        "--center_z", f"{center[2]:.3f}",
        "--size_x", f"{size[0]:.1f}",
        "--size_y", f"{size[1]:.1f}",
        "--size_z", f"{size[2]:.1f}",
        "--exhaustiveness", str(int(dock_cfg.get("exhaustiveness", 8))),
        "--num_modes", str(int(dock_cfg.get("num_modes", 9))),
        "--energy_range", str(dock_cfg.get("energy_range", 3)),
        "--seed", str(int(dock_cfg.get("seed", 42))),
        "--out", str(out_path),
    ]
    cpu = int(dock_cfg.get("cpu", 0) or 0)
    if cpu > 0:
        cmd += ["--cpu", str(cpu)]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        raise VinaError(f"Vina timed out after {timeout_seconds}s for {ligand_pdbqt.name}") from exc
    except OSError as exc:
        raise VinaError(f"could not execute Vina at {binary}: {exc}") from exc

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-600:]
        raise VinaError(f"Vina exited with code {proc.returncode}: {detail}")

    poses = parse_vina_output(proc.stdout or "")
    if not poses:
        raise VinaError(
            f"Vina produced no scored poses for {ligand_pdbqt.name}; "
            f"output tail: {(proc.stdout or '')[-300:]}"
        )

    return VinaResult(poses=poses, out_path=out_path, stdout=proc.stdout or "")
