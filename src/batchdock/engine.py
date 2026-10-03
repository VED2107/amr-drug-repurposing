"""Run AutoDock Vina for one job and turn its output into a checked result.

Nothing here produces a number Vina did not print. The pose table is parsed
from Vina's stdout and cross-checked against the `REMARK VINA RESULT` lines of
the pose file it wrote; if the two disagree, or either is empty, or any value is
not finite, the job fails.
"""

from __future__ import annotations

import math
import re
import shlex
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from ..docking.vina_runner import parse_vina_output
from .config import DockingParameters
from .prepare import validate_pdbqt

_REMARK = re.compile(r"^REMARK VINA RESULT:\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)", re.M)


class EngineError(RuntimeError):
    def __init__(self, message: str, *, transient: bool, status: str = "DOCKING_FAILED") -> None:
        super().__init__(message)
        self.transient = transient
        self.status = status


class Cancelled(RuntimeError):
    """The process was killed because the worker is shutting down."""


@dataclass
class EngineRun:
    poses: list[dict]
    best_affinity: float
    pose_text: str
    log_text: str
    command: str
    duration_seconds: float


def engine_version(binary: Path) -> str:
    proc = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=60)
    text = (proc.stdout or proc.stderr or "").strip()
    m = re.search(r"v?(\d+\.\d+\.\d+)", text)
    if not m:
        raise EngineError(f"cannot read the Vina version from {binary}: {text[:200]!r}", transient=False)
    return m.group(1)


def build_command(binary: Path, receptor: Path, ligand: Path, out: Path,
                  center: tuple[float, float, float], params: DockingParameters, cpu: int) -> list[str]:
    s = params.box_size
    return [
        str(binary), "--receptor", str(receptor), "--ligand", str(ligand),
        "--center_x", f"{center[0]:.3f}", "--center_y", f"{center[1]:.3f}", "--center_z", f"{center[2]:.3f}",
        "--size_x", f"{s[0]:.1f}", "--size_y", f"{s[1]:.1f}", "--size_z", f"{s[2]:.1f}",
        "--exhaustiveness", str(params.exhaustiveness), "--num_modes", str(params.num_modes),
        "--energy_range", f"{params.energy_range:g}", "--seed", str(params.seed),
        "--cpu", str(cpu), "--out", str(out),
    ]


# Vina's stdout table is fixed-width: 3 dp for -9.631, but only 2 dp once the
# score reaches -10 (-11.034 prints as -11.03). The file always has 3 dp and is
# what gets stored; stdout must agree with it to within its own rounding.
_STDOUT_TOLERANCE = 0.0051


def parse_and_check(stdout: str, pose_text: str, num_modes: int, energy_range: float = 3.0) -> list[dict]:
    """Return the poses Vina wrote, or raise if its output is empty, inconsistent or invalid.

    The pose file is the output. Vina 1.2.5 prints up to `num_modes` rows on
    stdout but writes only the poses within `energy_range` of the best one, so
    the file may hold fewer. The file's poses must equal the first rows of the
    stdout table, and any further rows must lie outside the energy range; only
    the written poses are returned.
    """
    table = parse_vina_output(stdout)
    if not table:
        raise EngineError("Vina printed no pose table", transient=False)
    remarks = [(float(a), float(b), float(c)) for a, b, c in _REMARK.findall(pose_text)]
    models = len(re.findall(r"^MODEL\s+\d+", pose_text, re.M))
    if not remarks or models != len(remarks):
        raise EngineError(f"pose file is empty or malformed ({models} models, {len(remarks)} results)",
                          transient=False)
    if len(remarks) > len(table) or len(table) > num_modes:
        raise EngineError(f"pose file has {len(remarks)} poses but Vina reported {len(table)}",
                          transient=False)
    cutoff = table[0].score_kcal_mol + energy_range
    unwritten = [p for p in table[len(remarks):] if p.score_kcal_mol <= cutoff + _STDOUT_TOLERANCE]
    if unwritten:
        raise EngineError(f"pose file has {len(remarks)} poses but Vina reported {len(table)} "
                          "within the energy range", transient=False)
    poses = []
    for pose, (aff, lb, ub) in zip(table, remarks):
        values = [pose.score_kcal_mol, aff, lb, ub]
        if not all(math.isfinite(v) for v in values):
            raise EngineError("non-finite score in Vina output", transient=False)
        if abs(pose.score_kcal_mol - aff) > _STDOUT_TOLERANCE:
            raise EngineError(f"pose {pose.rank}: stdout {pose.score_kcal_mol} != file {aff}",
                              transient=False)
        poses.append({"rank": pose.rank, "affinity": aff, "rmsd_lb": lb, "rmsd_ub": ub})
    if [p["rank"] for p in poses] != list(range(1, len(poses) + 1)):
        raise EngineError("pose ranks are not 1..n", transient=False)
    problems = validate_pdbqt(pose_text, ligand=False)
    if problems:
        raise EngineError("pose file invalid: " + "; ".join(problems), transient=False)
    return poses


class VinaRunner:
    """Runs Vina processes and can kill them all on shutdown."""

    def __init__(self, binary: Path, params: DockingParameters, cpu: int, timeout: int) -> None:
        self.binary, self.params, self.cpu, self.timeout = binary, params, cpu, timeout
        self._procs: set[subprocess.Popen] = set()
        self._lock = threading.Lock()
        self._killed = False

    def kill_all(self) -> None:
        with self._lock:
            self._killed = True
            for p in list(self._procs):
                try:
                    p.kill()
                except OSError:
                    pass

    def run(self, receptor: Path, ligand: Path, out: Path,
            center: tuple[float, float, float]) -> EngineRun:
        cmd = build_command(self.binary, receptor, ligand, out, center, self.params, self.cpu)
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            out.unlink()
        start = time.monotonic()
        with self._lock:
            if self._killed:
                raise Cancelled("worker is shutting down")
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self._procs.add(proc)
        try:
            try:
                stdout, _ = proc.communicate(timeout=self.timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                raise EngineError(
                    f"Vina exceeded the {self.timeout} s per-job limit (DOCKING_TIMEOUT); no score "
                    "was produced", transient=False)
        finally:
            with self._lock:
                self._procs.discard(proc)
        duration = time.monotonic() - start
        if self._killed:
            raise Cancelled("Vina killed during shutdown")
        stdout = stdout or ""
        if proc.returncode != 0:
            tail = stdout.strip()[-600:]
            # A bad atom type or parse error is deterministic; anything else
            # (signal, out-of-memory) may be the machine, so retry it.
            deterministic = any(s in tail for s in ("Parse error", "not a valid AutoDock type",
                                                     "ATOM syntax incorrect", "PDBQT parsing error"))
            raise EngineError(f"Vina exited with code {proc.returncode}: {tail}", transient=not deterministic)
        if not out.exists() or out.stat().st_size == 0:
            raise EngineError("Vina exited 0 but wrote no pose file", transient=False)
        pose_text = out.read_text(encoding="utf-8")
        poses = parse_and_check(stdout, pose_text, self.params.num_modes, self.params.energy_range)
        return EngineRun(poses, poses[0]["affinity"], pose_text, stdout,
                         " ".join(shlex.quote(c) for c in cmd), duration)
