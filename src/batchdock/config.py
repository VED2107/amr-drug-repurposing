"""Configuration for batch docking, from the environment.

Two kinds of setting live here and must not be confused:

* **Scientific parameters** (`DockingParameters`): anything that can change a
  score. They are hashed into a configuration id; a result is only ever
  compared with, or deduplicated against, results under the same hash.
* **Operational settings** (`Settings`): concurrency, timeouts, leases,
  storage. They change how fast the work goes, never what a score is.

`DOCKING_EXHAUSTIVENESS` is the one environment variable that is scientific.
Changing it creates a different configuration and therefore a different set of
jobs; it never relabels existing results.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

#: How a ligand becomes a docking input. Recorded verbatim with every result.
LIGAND_METHOD = (
    "amr.molecules.canonical_smiles (ChEMBL parent, standardised by src.chemistry.standardize: "
    "largest fragment, neutralised) -> RDKit SanitizeMol -> AddHs -> ETKDGv3 embed "
    "(seed 42, up to 3 attempts, random-coords fallback) -> MMFF94 optimisation (UFF if MMFF "
    "lacks parameters, 500 iterations) -> Meeko 0.8.0 MoleculePreparation defaults (Gasteiger "
    "charges, AD4 atom types, non-polar H merged, amide bonds rigid, macrocycles of 7-33 atoms "
    "made flexible by glue-atom ring opening) -> PDBQT. No pH-dependent "
    "re-protonation: the neutral standardised parent is docked."
)

#: How a receptor becomes a docking input.
RECEPTOR_METHOD = (
    "RCSB PDB entry -> single declared chain, ATOM records only (waters, ions and buffer "
    "molecules removed), primary altloc 'A' -> Meeko 0.8.0 mk_prepare_receptor (hydrogens "
    "added, Gasteiger charges, incomplete residues deleted only beyond 10 A of the box; inside "
    "the box they fail preparation) -> rigid PDBQT. The bound cofactor declared in "
    "configs/targets.yaml (NADPH/NADP+/NAD+) is retained at its crystal coordinates as rigid "
    "receptor atoms (CCD bond orders, hydrogens added in place, Meeko typing). Box centre from "
    "the co-crystallised ligand centroid or named catalytic residues."
)


class SettingsError(RuntimeError):
    """The environment cannot support the requested operation."""


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SettingsError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise SettingsError(f"{name} must be >= {minimum}, got {value}")
    return value


def available_cpus() -> int:
    """CPUs this process may actually use (cgroup/affinity aware where possible)."""
    try:
        return max(1, len(os.sched_getaffinity(0)))  # type: ignore[attr-defined]
    except AttributeError:
        return max(1, os.cpu_count() or 1)


def default_concurrency(cpu_per_job: int) -> int:
    """Leave one CPU for the OS, the heartbeat and the database client."""
    return max(1, (available_cpus() - 1) // max(1, cpu_per_job))


@dataclass(frozen=True)
class DockingParameters:
    """Everything that can change a docking score. Hashed into config_hash."""

    engine: str = "AutoDock Vina"
    engine_version: str = "1.2.5"
    exhaustiveness: int = 8
    num_modes: int = 9
    energy_range: float = 3.0
    seed: int = 42
    box_size: tuple[float, float, float] = (22.0, 22.0, 22.0)
    ligand_conformer_seed: int = 42
    receptor_method: str = RECEPTOR_METHOD
    ligand_method: str = LIGAND_METHOD
    #: Bumped by hand whenever the preparation code changes in a way that could
    #: change an input file; part of the hash.
    protocol_version: str = "batchdock-2"

    def canonical(self) -> dict:
        data = asdict(self)
        data["box_size"] = [float(v) for v in self.box_size]
        data["energy_range"] = float(self.energy_range)
        return data

    @property
    def config_hash(self) -> str:
        blob = json.dumps(self.canonical(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    @property
    def version_label(self) -> str:
        return (f"vina-{self.engine_version}/exh{self.exhaustiveness}/modes{self.num_modes}"
                f"/seed{self.seed}/{self.protocol_version}")


@dataclass(frozen=True)
class Settings:
    """Operational settings for one process."""

    database_url: str
    artifact_dir: Path
    vina_binary: Path | None
    concurrency: int
    cpu_per_job: int
    timeout_seconds: int
    max_attempts: int
    lease_seconds: int
    heartbeat_seconds: int
    claim_batch: int
    storage_url: str | None
    storage_key: str | None
    storage_bucket: str
    worker_id: str = field(default_factory=lambda: f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}")

    @property
    def remote_storage(self) -> bool:
        return bool(self.storage_url and self.storage_key)

    def describe(self) -> str:
        """One line, no secrets."""
        return (
            f"worker={self.worker_id} concurrency={self.concurrency} cpu_per_job={self.cpu_per_job} "
            f"timeout={self.timeout_seconds}s attempts={self.max_attempts} lease={self.lease_seconds}s "
            f"artifacts={self.artifact_dir} remote_storage={'on' if self.remote_storage else 'off'} "
            f"vina={self.vina_binary}"
        )


def resolve_vina() -> Path | None:
    env = os.environ.get("DOCKING_VINA_BIN") or os.environ.get("AMR_VINA_BIN")
    candidates = [env] if env else []
    candidates += [str(PROJECT_ROOT / "tools" / "vina.exe"), "/usr/local/bin/vina"]
    for c in candidates:
        if c and Path(c).exists():
            return Path(c)
    found = shutil.which("vina")
    return Path(found) if found else None


def parameters_from_env() -> DockingParameters:
    return DockingParameters(exhaustiveness=_env_int("DOCKING_EXHAUSTIVENESS", 8))


def load_settings(*, require_database: bool = True) -> Settings:
    url = (os.environ.get("DOCKING_DATABASE_URL") or os.environ.get("AMR_DATABASE_URL")
           or os.environ.get("DATABASE_URL") or "").strip()
    if require_database and not url:
        raise SettingsError("set DOCKING_DATABASE_URL (or AMR_DATABASE_URL / DATABASE_URL)")
    cpu_per_job = _env_int("DOCKING_CPU_PER_JOB", 1)
    concurrency = _env_int("DOCKING_CONCURRENCY", default_concurrency(cpu_per_job))
    timeout = _env_int("DOCKING_TIMEOUT", 1800)
    lease = _env_int("DOCKING_LEASE_SECONDS", 180, minimum=30)
    return Settings(
        database_url=url,
        artifact_dir=Path(os.environ.get("DOCKING_ARTIFACT_DIR")
                          or PROJECT_ROOT / "data" / "docking"),
        vina_binary=resolve_vina(),
        concurrency=concurrency,
        cpu_per_job=cpu_per_job,
        timeout_seconds=timeout,
        max_attempts=_env_int("DOCKING_RETRIES", 2, minimum=0) + 1,
        lease_seconds=lease,
        heartbeat_seconds=max(10, lease // 4),
        claim_batch=_env_int("DOCKING_CLAIM_BATCH", 1),
        storage_url=(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or None),
        storage_key=(os.environ.get("SUPABASE_SECRET_KEY") or None),
        storage_bucket=os.environ.get("DOCKING_STORAGE_BUCKET", "docking-artifacts"),
    )
