"""Prepare every input exactly once: 1 PDBQT per ligand, 1 PDBQT per receptor.

Ligands are prepared in a process pool (RDKit embedding is CPU-bound); the
files are then written to the artifact store and registered. A ligand that is
already READY under the current protocol is never prepared again.

Failures are recorded with a status and the exact reason, never replaced with
a different molecule:

  STRUCTURE_UNAVAILABLE      no structure exists for the medicine
  LIGAND_PREPARATION_FAILED  a structure exists but could not become a valid,
                             single-component, dockable 3D ligand
  TARGET_PREPARATION_FAILED  the receptor or its binding site could not be
                             prepared as declared
"""

from __future__ import annotations

import math
import multiprocessing as mp
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Iterable

from ..logging_utils import get_logger
from .artifacts import ArtifactStore
from .config import DockingParameters, available_cpus

log = get_logger("amr.batchdock.prepare")

#: AutoDock atom types that AutoDock Vina 1.2.5 can score. A PDBQT carrying any
#: other type (a metal Vina has no parameters for, a boron atom typed by Meeko
#: as something Vina rejects) is a preparation failure, caught here rather than
#: discovered as a docking crash.
VINA_ATOM_TYPES = frozenset({
    "C", "A", "N", "NA", "NS", "O", "OA", "OS", "S", "SA", "P", "F", "Cl", "CL", "Br", "BR",
    "I", "H", "HD", "HS", "Si", "Mg", "MG", "Mn", "MN", "Zn", "ZN", "Ca", "CA", "Fe", "FE",
    "Met", "G0", "G1", "G2", "G3", "CG0", "CG1", "CG2", "CG3",
})


class PreparationError(RuntimeError):
    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# PDBQT validation (shared by ligands, receptors and pose files)
# ---------------------------------------------------------------------------

_ATOM = re.compile(r"^(ATOM  |HETATM)")


def pdbqt_atoms(text: str) -> list[tuple[float, float, float, str]]:
    """(x, y, z, autodock_type) for every atom record."""
    atoms = []
    for line in text.splitlines():
        if not _ATOM.match(line):
            continue
        try:
            x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
        except ValueError as exc:
            raise ValueError(f"unreadable coordinates in: {line!r}") from exc
        atype = line[77:].strip() if len(line) > 77 else ""
        atoms.append((x, y, z, atype))
    return atoms


def validate_pdbqt(text: str, *, ligand: bool) -> list[str]:
    """Return a list of problems; empty means the file is structurally valid."""
    problems: list[str] = []
    try:
        atoms = pdbqt_atoms(text)
    except ValueError as exc:
        return [str(exc)]
    if not atoms:
        return ["no ATOM/HETATM records"]
    if any(not all(math.isfinite(v) for v in a[:3]) for a in atoms):
        problems.append("non-finite coordinates")
    bad = sorted({a[3] for a in atoms if a[3] not in VINA_ATOM_TYPES})
    if bad:
        problems.append(f"atom types AutoDock Vina cannot score: {', '.join(bad)}")
    if ligand:
        if "ROOT" not in text or "ENDROOT" not in text:
            problems.append("missing ROOT/ENDROOT torsion tree")
        if not re.search(r"^TORSDOF\s+\d+", text, re.M):
            problems.append("missing TORSDOF")
        # Glue pseudo-atoms (G0..G3) of an opened macrocycle sit exactly on their
        # partner carbon by design; every real atom must have its own position.
        real = [a for a in atoms if not _is_glue(a[3])]
        coords = {(round(a[0], 3), round(a[1], 3), round(a[2], 3)) for a in real}
        if len(coords) < len(real):
            problems.append("overlapping atoms (duplicate coordinates)")
    return problems


def _is_glue(atype: str) -> bool:
    return re.fullmatch(r"G\d", atype) is not None


def torsdof(text: str) -> int | None:
    m = re.search(r"^TORSDOF\s+(\d+)", text, re.M)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# Ligands
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LigandInput:
    ligand_id: str
    molecule_id: str | None
    name: str | None
    smiles: str | None
    inchikey: str | None
    structure_source: str


@dataclass(frozen=True)
class LigandOutcome:
    ligand_id: str
    status: str                 # READY | STRUCTURE_UNAVAILABLE | LIGAND_PREPARATION_FAILED
    error: str | None = None
    canonical_smiles: str | None = None
    inchi: str | None = None
    inchikey: str | None = None
    heavy_atoms: int | None = None
    rotatable_bonds: int | None = None
    torsions: int | None = None
    sdf: bytes | None = None
    pdbqt: bytes | None = None


def prepare_ligand_files(item: LigandInput, conformer_seed: int = 42) -> LigandOutcome:
    """SMILES -> validated 3D SDF + PDBQT. Pure function; safe in a worker process."""
    from meeko import MoleculePreparation, PDBQTWriterLegacy
    from rdkit import Chem, RDLogger
    from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors

    RDLogger.DisableLog("rdApp.*")

    def fail(status: str, msg: str) -> LigandOutcome:
        return LigandOutcome(item.ligand_id, status, msg[:1000])

    smiles = (item.smiles or "").strip()
    if not smiles:
        return fail("STRUCTURE_UNAVAILABLE", "no chemical structure is recorded for this medicine")

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return fail("LIGAND_PREPARATION_FAILED", f"malformed SMILES: RDKit could not parse {smiles!r}")
    if len(Chem.GetMolFrags(mol)) != 1:
        return fail("LIGAND_PREPARATION_FAILED",
                    "structure has more than one component; no component is chosen silently")

    canonical = Chem.MolToSmiles(mol)
    inchi = Chem.MolToInchi(mol) or None
    inchikey = Chem.MolToInchiKey(mol) or None
    # The stored id is an InChIKey of the standardised parent. If the structure
    # does not reproduce its connectivity block, the row and its id disagree,
    # and docking it would attach a score to the wrong medicine.
    if item.inchikey and inchikey and item.inchikey.split("-")[0] != inchikey.split("-")[0]:
        return fail("LIGAND_PREPARATION_FAILED",
                    f"structure does not match its recorded InChIKey ({item.inchikey} vs {inchikey})")

    heavy = mol.GetNumHeavyAtoms()
    rot = int(rdMolDescriptors.CalcNumRotatableBonds(mol))
    molh = Chem.AddHs(mol)

    embedded = False
    for attempt in range(3):
        params = AllChem.ETKDGv3()
        params.randomSeed = conformer_seed + attempt
        params.useRandomCoords = attempt > 0
        if hasattr(params, "timeout"):
            params.timeout = 180
        if AllChem.EmbedMolecule(molh, params) == 0:
            embedded = True
            break
    if not embedded:
        return fail("LIGAND_PREPARATION_FAILED", "3D embedding (ETKDGv3) failed after 3 seeded attempts")

    try:
        if AllChem.MMFFHasAllMoleculeParams(molh):
            AllChem.MMFFOptimizeMolecule(molh, maxIters=500)
        else:
            AllChem.UFFOptimizeMolecule(molh, maxIters=500)
    except Exception:
        pass  # an unoptimised but valid conformer is still a valid starting geometry

    conf = molh.GetConformer()
    if any(not math.isfinite(c) for p in conf.GetPositions() for c in p):
        return fail("LIGAND_PREPARATION_FAILED", "embedded conformer has non-finite coordinates")

    molh.SetProp("_Name", item.ligand_id)
    sdf = Chem.MolToMolBlock(molh) + "$$$$\n"

    try:
        setups = MoleculePreparation().prepare(molh)
    except Exception as exc:
        return fail("LIGAND_PREPARATION_FAILED", f"Meeko preparation failed: {type(exc).__name__}: {exc}")
    if not setups:
        return fail("LIGAND_PREPARATION_FAILED", "Meeko produced no molecule setup")
    pdbqt, ok, err = PDBQTWriterLegacy.write_string(setups[0])
    if not ok:
        return fail("LIGAND_PREPARATION_FAILED", f"PDBQT writing failed: {err}")

    problems = validate_pdbqt(pdbqt, ligand=True)
    if problems:
        return fail("LIGAND_PREPARATION_FAILED", "invalid PDBQT: " + "; ".join(problems))
    # Every heavy atom must survive into the PDBQT.
    n_heavy_pdbqt = sum(1 for a in pdbqt_atoms(pdbqt) if a[3] not in ("H", "HD", "HS") and not _is_glue(a[3]))
    if n_heavy_pdbqt != heavy:
        return fail("LIGAND_PREPARATION_FAILED",
                    f"PDBQT has {n_heavy_pdbqt} heavy atoms, the molecule has {heavy}")

    return LigandOutcome(
        item.ligand_id, "READY", None, canonical, inchi, inchikey, heavy, rot,
        torsdof(pdbqt), sdf.encode("utf-8"), pdbqt.encode("utf-8"),
    )


def _prepare_star(args: tuple[LigandInput, int]) -> LigandOutcome:
    item, seed = args
    try:
        return prepare_ligand_files(item, seed)
    except Exception as exc:  # a crash in one ligand must not take down the pool
        return LigandOutcome(item.ligand_id, "LIGAND_PREPARATION_FAILED",
                             f"unexpected {type(exc).__name__}: {exc}"[:1000])


def library_ligand_inputs(conn) -> list[LigandInput]:
    """Every approved medicine in the library (distinct molecule in amr.drugs)."""
    rows = conn.execute(
        """select m.molecule_id, m.chembl_id, m.canonical_smiles, m.inchikey, m.feature_version,
                  coalesce(d.name, m.pref_name, m.molecule_id) as name
             from amr.molecules m
             join (select molecule_id, min(generic_name) as name from amr.drugs
                    where molecule_id is not null group by molecule_id) d
               on d.molecule_id = m.molecule_id
            order by m.molecule_id"""
    ).fetchall()
    out = []
    for mid, chembl, smi, ik, fv, name in rows:
        src = (f"ChEMBL {chembl}" if chembl else "FDA Orange Book record") + \
              f" -> amr.molecules.canonical_smiles (standardised, feature_version {fv})"
        out.append(LigandInput(mid, mid, name, smi, ik, src))
    return out


def prepare_ligands(conn, store: ArtifactStore, params: DockingParameters,
                    inputs: Iterable[LigandInput], *, force: bool = False,
                    processes: int | None = None) -> dict[str, int]:
    """Prepare and register ligands. Returns counts by status."""
    inputs = list(inputs)
    method = params.ligand_method
    done = {r[0] for r in conn.execute(
        "select ligand_id from docking.ligands where preparation_status <> 'PENDING' "
        "and preparation_method = %s", (method,)).fetchall()}
    todo = [i for i in inputs if force or i.ligand_id not in done]
    log.info("ligands: %d in scope, %d already prepared under this protocol, %d to prepare",
             len(inputs), len(inputs) - len(todo), len(todo))

    # Register every row first (one statement), so a crash mid-way leaves
    # PENDING rows, not missing ones.
    if todo:
        conn.execute(
            """insert into docking.ligands(ligand_id, molecule_id, name, canonical_smiles, inchikey,
                   structure_source, preparation_status)
               select a, b, c, d, e, f, 'PENDING'
                 from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::text[], %s::text[])
                      as v(a, b, c, d, e, f)
               on conflict (ligand_id) do update set name = excluded.name,
                   structure_source = excluded.structure_source""",
            ([i.ligand_id for i in todo], [i.molecule_id for i in todo], [i.name for i in todo],
             [i.smiles for i in todo], [i.inchikey for i in todo], [i.structure_source for i in todo]))

    counts: dict[str, int] = {}
    if not todo:
        return counts
    procs = processes or available_cpus()
    ctx = mp.get_context("spawn")
    uploads = ThreadPoolExecutor(max_workers=16)
    batch: list = []

    def flush() -> None:
        written = [f.result() for f in batch]
        batch.clear()
        staged = [s for _, sdf, pdbqt in written for s in (sdf, pdbqt) if s is not None]
        arts = store.register_many(conn, staged)
        _record_ligands(conn, [(o, arts[sdf.object_key].id if sdf else None,
                                arts[pdbqt.object_key].id if pdbqt else None)
                               for o, sdf, pdbqt in written], method)

    with ctx.Pool(procs) as pool:
        for n, outcome in enumerate(pool.imap_unordered(
                _prepare_star, [(i, params.ligand_conformer_seed) for i in todo], chunksize=4), 1):
            batch.append(uploads.submit(_write_ligand, store, outcome))
            counts[outcome.status] = counts.get(outcome.status, 0) + 1
            if len(batch) >= 100:
                flush()
            if n % 200 == 0:
                log.info("ligands prepared: %d / %d %s", n, len(todo), counts)
    flush()
    uploads.shutdown()
    return counts


def _write_ligand(store: ArtifactStore, o: LigandOutcome):
    if o.status != "READY":
        return o, None, None
    key = o.ligand_id.replace(":", "_")
    sdf = store.write("ligand_sdf", f"ligands/{key}.sdf", o.sdf, "chemical/x-mdl-sdfile")
    pdbqt = store.write("ligand_pdbqt", f"ligands/{key}.pdbqt", o.pdbqt, "text/plain")
    return o, sdf, pdbqt


def _record_ligands(conn, rows: list[tuple[LigandOutcome, int | None, int | None]], method: str) -> None:
    """Record many outcomes in one statement."""
    if not rows:
        return
    cols = list(zip(*[(o.ligand_id, o.canonical_smiles, o.inchi, o.inchikey, o.heavy_atoms,
                       o.rotatable_bonds, o.torsions, sdf, pdbqt, o.status, o.error)
                      for o, sdf, pdbqt in rows]))
    conn.execute(
        """update docking.ligands l set
               canonical_smiles = coalesce(v.smi, l.canonical_smiles), inchi = v.inchi,
               inchikey = coalesce(v.ik, l.inchikey), heavy_atoms = v.heavy, rotatable_bonds = v.rot,
               torsions = v.tors, sdf_artifact_id = v.sdf, pdbqt_artifact_id = v.pdbqt,
               preparation_method = %s, preparation_status = v.status, preparation_error = v.err,
               prepared_at = now()
          from unnest(%s::text[], %s::text[], %s::text[], %s::text[], %s::int[], %s::int[], %s::int[],
                      %s::bigint[], %s::bigint[], %s::text[], %s::text[])
               as v(id, smi, inchi, ik, heavy, rot, tors, sdf, pdbqt, status, err)
         where l.ligand_id = v.id""",
        (method, *[list(c) for c in cols]))


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

def ccd_smiles(code: str, http) -> str:
    """SMILES (bond orders) of a Chemical Component Dictionary entry, from RCSB."""
    from rdkit import Chem
    resp = http.get(f"https://files.rcsb.org/ligands/download/{code}_ideal.sdf", accept="text/plain")
    mol = Chem.MolFromMolBlock(resp.text, removeHs=True)
    if mol is None:
        raise RuntimeError(f"could not read the CCD ideal structure for {code}")
    return Chem.MolToSmiles(mol)


def crystal_ligand(pdb_text: str, code: str, chain: str, template_smiles: str):
    """A HETATM residue as an RDKit molecule at its crystal coordinates, bond
    orders assigned from the CCD template. First copy in the chain, altloc A."""
    from rdkit import Chem
    from rdkit.Chem import AllChem
    lines, first_res = [], None
    for l in pdb_text.splitlines():
        if l.startswith("HETATM") and l[17:20].strip() == code and l[21] == chain and l[16] in " A":
            res = l[22:27]
            first_res = first_res or res
            if res == first_res and l[76:78].strip() != "H":
                lines.append(l)
    if not lines:
        raise RuntimeError(f"{code} not found in chain {chain}")
    mol = Chem.MolFromPDBBlock("\n".join(lines) + "\nEND\n", removeHs=True, sanitize=False)
    return AllChem.AssignBondOrdersFromTemplate(Chem.MolFromSmiles(template_smiles), mol)


def cofactor_atoms(pdb_text: str, code: str, chain: str, http) -> list[str]:
    """The bound cofactor as rigid receptor PDBQT atom records, at its crystal
    coordinates: hydrogens added in place, AutoDock types and Gasteiger charges
    from Meeko. Vina scores it as part of the rigid receptor."""
    from meeko import MoleculePreparation, PDBQTWriterLegacy
    from rdkit import Chem
    mol = crystal_ligand(pdb_text, code, chain, ccd_smiles(code, http))
    Chem.SanitizeMol(mol)
    molh = Chem.AddHs(mol, addCoords=True)
    setups = MoleculePreparation(rigid_macrocycles=True).prepare(molh)
    text, ok, err = PDBQTWriterLegacy.write_string(setups[0])
    if not ok:
        raise RuntimeError(f"cofactor {code}: PDBQT writing failed: {err}")
    atoms = ["ATOM  " + l[6:17] + code.ljust(3)[:3] + l[20:21] + chain + l[22:]
             for l in text.splitlines() if l.startswith(("ATOM", "HETATM"))]
    if len(atoms) < mol.GetNumAtoms():
        raise RuntimeError(f"cofactor {code}: {len(atoms)} atoms written, {mol.GetNumAtoms()} heavy atoms in the crystal")
    return atoms


def _declared_cofactors() -> dict[str, str]:
    import yaml
    from ..config import PROJECT_ROOT as ROOT
    data = yaml.safe_load((ROOT / "configs" / "targets.yaml").read_text(encoding="utf-8")) or {}
    return {t["target_key"]: t["cofactor"] for t in data.get("targets") or [] if t.get("cofactor")}


ORGANISMS = {
    "mrsa": "Staphylococcus aureus (methicillin-resistant, MRSA)",
    "ecoli": "Escherichia coli",
    "kpneumoniae": "Klebsiella pneumoniae",
    "mtb": "Mycobacterium tuberculosis",
}


def prepare_targets(conn, store: ArtifactStore, params: DockingParameters, *,
                    force: bool = False, only: list[str] | None = None) -> dict[str, str]:
    """Prepare every target declared in configs/targets.yaml. Returns status per target."""
    from ..config import load_config
    from ..docking.receptor import ReceptorPreparationError, load_targets, prepare_receptor
    from ..ingestion.http import HttpClient

    cfg = load_config()
    specs, _ = load_targets()
    cofactors = _declared_cofactors()
    out: dict[str, str] = {}
    http = HttpClient(cfg)
    try:
        for t in specs:
            if only is not None and t.target_key not in only:
                continue
            row = conn.execute(
                "select preparation_status, preparation_method from docking.targets where target_id = %s",
                (t.target_key,)).fetchone()
            if row and row[0] == "READY" and row[1] == params.receptor_method and not force:
                out[t.target_key] = "READY"
                continue
            conn.execute(
                """insert into docking.targets(target_id, pathogen_key, organism, protein_name, gene,
                       uniprot_id, pdb_id, chain, structure_source, site_mode, site_reference,
                       preparation_status)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'PENDING')
                   on conflict (target_id) do update set pdb_id = excluded.pdb_id,
                       chain = excluded.chain, site_mode = excluded.site_mode,
                       site_reference = excluded.site_reference,
                       structure_source = excluded.structure_source""",
                (t.target_key, t.pathogen_key, ORGANISMS.get(t.pathogen_key, t.pathogen_key),
                 t.name, t.gene, t.uniprot, t.pdb_id, t.chain,
                 f"RCSB PDB {t.pdb_id.upper()} (experimental crystal structure), {t.structure_url}",
                 t.site_mode, t.site_reference))
            spec = t
            spec.box_size = tuple(params.box_size)  # type: ignore[assignment]
            try:
                prepared = prepare_receptor(cfg, spec, http=http, cache_dir=store.root / "receptors" / "_work",
                                            force=True)
                pdbqt_text = prepared.receptor_pdbqt.read_text(encoding="utf-8")
                site_note = prepared.notes
                src_path = store.root / "receptors" / "_work" / f"{t.pdb_id.upper()}.pdb"
                cof = cofactors.get(t.target_key)
                if cof:
                    protein = [l for l in pdbqt_text.splitlines() if l.startswith(("ATOM", "HETATM"))]
                    extra = cofactor_atoms(src_path.read_text(encoding="utf-8"), cof, t.chain, http)
                    pdbqt_text = "\n".join(protein + extra) + "\n"
                    site_note += f"; cofactor {cof} retained as {len(extra)} rigid receptor atoms"
                problems = validate_pdbqt(pdbqt_text, ligand=False)
                if problems:
                    raise ReceptorPreparationError("invalid receptor PDBQT: " + "; ".join(problems))
                atoms = pdbqt_atoms(pdbqt_text)
                xs, ys, zs = zip(*[(a[0], a[1], a[2]) for a in atoms])
                c = prepared.box_center
                if not (min(xs) <= c[0] <= max(xs) and min(ys) <= c[1] <= max(ys) and min(zs) <= c[2] <= max(zs)):
                    raise ReceptorPreparationError("box centre lies outside the protein; site definition rejected")
                src = store.put(conn, "receptor_source_pdb", f"receptors/{t.pdb_id.upper()}.pdb",
                                src_path.read_bytes(), "chemical/x-pdb")
                rec = store.put(conn, "receptor_pdbqt", f"receptors/{params.protocol_version}/{t.target_key}.pdbqt",
                                pdbqt_text.encode("utf-8"))
                conn.execute(
                    """update docking.targets set center_x=%s, center_y=%s, center_z=%s,
                           size_x=%s, size_y=%s, size_z=%s, binding_site_definition=%s,
                           n_protein_atoms=%s, source_artifact_id=%s, prepared_artifact_id=%s,
                           preparation_method=%s, preparation_status='READY',
                           preparation_error=null, prepared_at=now()
                       where target_id=%s""",
                    (c[0], c[1], c[2], *params.box_size, site_note, prepared.n_protein_atoms,
                     src.id, rec.id, params.receptor_method, t.target_key))
                out[t.target_key] = "READY"
                log.info("target %s READY (%s)", t.target_key, prepared.notes)
            except Exception as exc:
                conn.execute(
                    """update docking.targets set preparation_status='TARGET_PREPARATION_FAILED',
                           preparation_error=%s, preparation_method=%s, prepared_at=now()
                       where target_id=%s""",
                    (f"{type(exc).__name__}: {exc}"[:1000], params.receptor_method, t.target_key))
                out[t.target_key] = "TARGET_PREPARATION_FAILED"
                log.error("target %s failed: %s", t.target_key, exc)
    finally:
        http.close()
    return out
