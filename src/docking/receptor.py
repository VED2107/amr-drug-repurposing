"""Receptor preparation: fetch a PDB structure, isolate the chain, define the
search box from the structure itself, and write a rigid PDBQT with Meeko.

The search box is never hard-coded. It is derived either from a co-crystallised
ligand or from named catalytic residues, so the definition is reproducible from
the PDB entry alone.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from ..config import PROJECT_ROOT, Config
from ..logging_utils import get_logger
from ..ingestion.http import HttpClient

log = get_logger("amr.docking.receptor")

RCSB_PDB_URL = "https://files.rcsb.org/download/{pdb_id}.pdb"


class ReceptorPreparationError(RuntimeError):
    """Raised when a receptor cannot be prepared. Recorded, never silenced."""


@dataclass
class TargetSpec:
    """One docking target as declared in configs/targets.yaml."""

    target_key: str
    pathogen_key: str
    name: str
    pdb_id: str
    chain: str
    site_mode: str
    site_reference: str
    gene: str | None = None
    uniprot: str | None = None
    selection_notes: str = ""
    box_size: tuple[float, float, float] = (22.0, 22.0, 22.0)

    @property
    def structure_url(self) -> str:
        return RCSB_PDB_URL.format(pdb_id=self.pdb_id.upper())


@dataclass
class PreparedReceptor:
    """The artefacts produced for one target."""

    target: TargetSpec
    receptor_pdbqt: Path
    box_center: tuple[float, float, float]
    box_size: tuple[float, float, float]
    n_protein_atoms: int
    notes: str = ""
    warnings: list[str] = field(default_factory=list)


def load_targets(path: Path | None = None) -> tuple[list[TargetSpec], tuple[float, float, float]]:
    """Read configs/targets.yaml."""
    path = path or (PROJECT_ROOT / "configs" / "targets.yaml")
    if not path.exists():
        raise ReceptorPreparationError(f"targets file not found: {path}")

    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    size = tuple(float(v) for v in (data.get("box_size_angstrom") or [22.0, 22.0, 22.0]))
    if len(size) != 3:
        raise ReceptorPreparationError(f"box_size_angstrom must have three values, got {size}")

    targets: list[TargetSpec] = []
    for entry in data.get("targets") or []:
        targets.append(
            TargetSpec(
                target_key=entry["target_key"],
                pathogen_key=entry["pathogen_key"],
                name=entry["name"],
                pdb_id=entry["pdb_id"],
                chain=entry["chain"],
                site_mode=entry["site_mode"],
                site_reference=str(entry["site_reference"]),
                gene=entry.get("gene"),
                uniprot=entry.get("uniprot"),
                selection_notes=(entry.get("selection_notes") or "").strip(),
                box_size=size,  # type: ignore[arg-type]
            )
        )
    return targets, size  # type: ignore[return-value]


def fetch_structure(target: TargetSpec, cache_dir: Path, http: HttpClient) -> Path:
    """Download the PDB entry, caching it on disk."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{target.pdb_id.upper()}.pdb"
    if path.exists() and path.stat().st_size > 0:
        return path

    resp = http.get(target.structure_url, accept="text/plain")
    text = resp.text
    if "ATOM" not in text:
        raise ReceptorPreparationError(
            f"{target.pdb_id}: downloaded file contains no ATOM records"
        )
    path.write_text(text, encoding="utf-8")
    log.info("fetched structure %s (%d bytes)", target.pdb_id, len(text))
    return path


def _coords(lines: list[str]) -> np.ndarray:
    return np.array(
        [[float(l[30:38]), float(l[38:46]), float(l[46:54])] for l in lines], dtype=float
    )


def compute_box_center(pdb_text: str, target: TargetSpec) -> tuple[tuple[float, float, float], str]:
    """Derive the search-box centre from the structure. Returns (centre, note)."""
    lines = pdb_text.splitlines()

    if target.site_mode == "ligand":
        code = target.site_reference.strip().upper()
        selected = [
            l for l in lines
            if l.startswith("HETATM") and l[17:20].strip().upper() == code and l[21] == target.chain
        ]
        if not selected:
            raise ReceptorPreparationError(
                f"{target.pdb_id}: ligand {code} not found in chain {target.chain}"
            )
        centre = _coords(selected).mean(axis=0)
        note = f"box centred on co-crystallised ligand {code} ({len(selected)} atoms)"

    elif target.site_mode == "residues":
        wanted = {int(v.strip()) for v in target.site_reference.split(",") if v.strip()}
        selected, found = [], set()
        for l in lines:
            if not l.startswith("ATOM") or l[21] != target.chain:
                continue
            try:
                resnum = int(l[22:26])
            except ValueError:
                continue
            if resnum in wanted:
                selected.append(l)
                found.add(resnum)
        missing = sorted(wanted - found)
        if missing:
            raise ReceptorPreparationError(
                f"{target.pdb_id}: catalytic residues {missing} absent from chain {target.chain}; "
                "the binding site cannot be defined as configured"
            )
        centre = _coords(selected).mean(axis=0)
        note = f"box centred on catalytic residues {sorted(wanted)} ({len(selected)} atoms)"

    else:
        raise ReceptorPreparationError(f"unknown site_mode: {target.site_mode!r}")

    return (float(centre[0]), float(centre[1]), float(centre[2])), note


def _mk_prepare_receptor_executable() -> Path:
    """Locate Meeko's receptor preparation entry point in this interpreter."""
    scripts = Path(sys.executable).parent
    for name in ("mk_prepare_receptor.exe", "mk_prepare_receptor"):
        candidate = scripts / name
        if candidate.exists():
            return candidate
    raise ReceptorPreparationError(
        "mk_prepare_receptor was not found next to the running interpreter; "
        "install meeko into this environment"
    )


def prepare_receptor(
    cfg: Config,
    target: TargetSpec,
    *,
    http: HttpClient | None = None,
    cache_dir: Path | None = None,
    force: bool = False,
) -> PreparedReceptor:
    """Produce a rigid receptor PDBQT and the search box for one target."""
    cache_dir = cache_dir or (PROJECT_ROOT / str(cfg.get("docking", "receptor_cache_dir",
                                                         default="data/external/receptors")))
    cache_dir.mkdir(parents=True, exist_ok=True)
    own_http = http is None
    http = http or HttpClient(cfg)

    try:
        structure_path = fetch_structure(target, cache_dir, http)
        pdb_text = structure_path.read_text(encoding="utf-8")

        centre, centre_note = compute_box_center(pdb_text, target)

        # Isolate one chain, protein atoms only. Waters, buffer molecules and
        # cofactors are excluded, which is stated in the target notes so the
        # score is never read as including cofactor contacts.
        protein = [
            l for l in pdb_text.splitlines()
            if l.startswith("ATOM") and l[21] == target.chain
        ]
        if not protein:
            raise ReceptorPreparationError(
                f"{target.pdb_id}: no protein atoms in chain {target.chain}"
            )

        # Keep only the primary altloc so Meeko does not see duplicate atoms.
        protein = [l for l in protein if l[16] in (" ", "A")]

        chain_pdb = cache_dir / f"{target.target_key}_chain.pdb"
        chain_pdb.write_text("\n".join(protein) + "\nEND\n", encoding="utf-8")

        receptor_pdbqt = cache_dir / f"{target.target_key}.pdbqt"
        if receptor_pdbqt.exists() and not force:
            log.info("%s: reusing cached receptor %s", target.target_key, receptor_pdbqt.name)
            return PreparedReceptor(
                target, receptor_pdbqt, centre, target.box_size, len(protein),
                notes=f"{centre_note}; cached receptor reused",
            )

        dock_cfg = cfg.get("docking", default={}) or {}
        cmd = [
            str(_mk_prepare_receptor_executable()),
            "--read_pdb", str(chain_pdb),
            "-o", str(cache_dir / target.target_key),
            "-p",
            "--box_center", f"{centre[0]:.3f}", f"{centre[1]:.3f}", f"{centre[2]:.3f}",
            "--box_size", *[f"{v:.1f}" for v in target.box_size],
            "-v",
            # Crystal structures routinely carry alternate conformations. Pick
            # the primary one deterministically rather than letting preparation
            # fail, or worse, pick one at random between runs.
            "--default_altloc", str(dock_cfg.get("default_altloc", "A")),
            # Deposited structures often have incomplete residues at chain
            # termini or on disordered surface loops. Those cannot be typed.
            # Deleting them OUTSIDE the given radius of the search box keeps
            # preparation working while still failing loudly if the broken
            # residue is anywhere near the binding site, where it would matter.
            "--delete_bad_res_from_box_radius",
            str(float(dock_cfg.get("delete_bad_residues_beyond_angstrom", 10.0))),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if proc.returncode != 0 or not receptor_pdbqt.exists():
            raise ReceptorPreparationError(
                f"{target.target_key}: mk_prepare_receptor failed (rc={proc.returncode}): "
                f"{(proc.stderr or proc.stdout or '')[-600:]}"
            )

        warnings: list[str] = []
        if "warning" in (proc.stdout or "").lower():
            warnings.append("mk_prepare_receptor emitted warnings; see the pipeline log")
            log.debug("%s receptor prep stdout: %s", target.target_key, proc.stdout[-1500:])

        log.info("%s: receptor prepared, %d protein atoms, %s",
                 target.target_key, len(protein), centre_note)
        return PreparedReceptor(
            target, receptor_pdbqt, centre, target.box_size, len(protein),
            notes=centre_note, warnings=warnings,
        )
    finally:
        if own_http:
            http.close()
