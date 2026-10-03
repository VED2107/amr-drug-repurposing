"""Quality control and the scientific validation run.

`qc()` checks the stored state for the failure modes that would make a number
on the dashboard wrong: malformed or missing inputs, missing boxes, results
without jobs, jobs without results, duplicates, stale leases, non-finite or
inconsistent scores and corrupted artifacts.

`validation_run()` docks a few known ligand-target pairs before the full batch:

* Redocking: the co-crystallised ligand of each structure that has one
  (trimethoprim in 3FRE, folate in 1RX2, the InhA inhibitor in 4TZK) is taken
  from the RCSB Chemical Component Dictionary, prepared by the same protocol,
  docked, and its poses compared with the crystal coordinates (symmetry-aware
  heavy-atom RMSD, no superposition). The pass criterion is fixed in advance:
  a pose within 2.5 A among the top three.
* Known library pairs: medicines with documented activity at these targets,
  docked as ordinary campaign jobs (they are not repeated by the full run).
* Pipeline checks: every validation job completed with a checked result,
  scores parse, poses exist, artifacts match their checksums, and re-enqueueing
  creates no duplicate.

The full run must not start until this passes (`cli enqueue` refuses).
"""

from __future__ import annotations

import json
from typing import Any

from ..logging_utils import get_logger
from . import queue as q
from .artifacts import ArtifactStore, sha256_file
from .config import DockingParameters, Settings
from .prepare import LigandInput, ccd_smiles, crystal_ligand, prepare_ligands

log = get_logger("amr.batchdock.validation")

REDOCK_RMSD_THRESHOLD = 2.5   # Angstrom, top-3 poses; fixed before any run
REDOCK_TOP_N = 3

#: target -> (CCD code, chain) for structures whose site is defined by a ligand.
REDOCK = {"sa_dhfr": ("TOP", "X"), "ec_dhfr": ("FOL", "A"), "mtb_inha": ("641", "A")}

#: Library medicines with documented activity at the target, by name.
KNOWN_PAIRS = [
    ("TRIMETHOPRIM", "sa_dhfr"), ("TRIMETHOPRIM", "ec_dhfr"),
    ("MEROPENEM", "kp_kpc2"), ("TRICLOSAN", "mtb_inha"),
]


# ---------------------------------------------------------------------------
# QC
# ---------------------------------------------------------------------------

def qc(conn, store: ArtifactStore, config_hash: str, *, deep: bool = False) -> dict[str, Any]:
    checks: dict[str, Any] = {}

    def count(sql: str, *args) -> int:
        return int(conn.execute(sql, args).fetchone()[0])

    checks["malformed_smiles"] = count(
        "select count(*) from docking.ligands where preparation_error like 'malformed SMILES%%'")
    checks["missing_structures"] = count(
        "select count(*) from docking.ligands where preparation_status = 'STRUCTURE_UNAVAILABLE'")
    checks["ready_ligand_without_pdbqt"] = count(
        "select count(*) from docking.ligands where preparation_status='READY' and pdbqt_artifact_id is null")
    checks["ready_target_without_receptor_or_box"] = count(
        """select count(*) from docking.targets where preparation_status='READY' and
             (prepared_artifact_id is null or center_x is null or size_x is null)""")
    checks["targets_not_ready"] = [r[0] for r in conn.execute(
        "select target_id from docking.targets where selected and preparation_status <> 'READY'")]
    checks["duplicate_jobs"] = count(
        """select count(*) from (select 1 from docking.jobs group by ligand_id, target_id, config_hash
             having count(*) > 1) d""")
    checks["completed_without_result"] = count(
        """select count(*) from docking.jobs j where j.status='COMPLETED'
             and not exists (select 1 from docking.results r where r.job_id = j.id)""")
    checks["result_without_completed_job"] = count(
        """select count(*) from docking.results r join docking.jobs j on j.id = r.job_id
            where j.status <> 'COMPLETED'""")
    checks["orphan_jobs_in_cancelled_runs"] = count(
        """select count(*) from docking.jobs j join docking.runs r on r.run_id = j.run_id
            where r.status = 'CANCELLED' and j.status in ('QUEUED','RUNNING')""")
    checks["stale_running_jobs"] = count(
        "select count(*) from docking.jobs where status='RUNNING' and lease_expires_at < now()")
    checks["invalid_scores"] = count(
        """select count(*) from docking.results where best_affinity = 'NaN'::float8
             or best_affinity <> (poses->0->>'affinity')::float8
             or poses_count <> jsonb_array_length(poses)""")
    checks["missing_library_pairs"] = count(
        """select count(*) from docking.ligands l cross join docking.targets t
            where l.molecule_id is not null and t.selected and not exists (
              select 1 from docking.jobs j where j.ligand_id = l.ligand_id
                and j.target_id = t.target_id and j.config_hash = %s)""", config_hash)

    corrupted: list[str] = []
    sql = """select object_key, sha256 from docking.artifacts""" + ("" if deep else
          """ where kind in ('receptor_pdbqt') or id in (select pdbqt_artifact_id from docking.ligands
              order by random() limit 25) or id in (select pose_artifact_id from docking.results
              order by random() limit 25)""")
    checked = 0
    for key, sha in conn.execute(sql).fetchall():
        checked += 1
        path = store.local_path(key)
        try:
            if path.exists():
                if sha256_file(path) != sha:
                    corrupted.append(key)
            else:
                store.fetch(key, sha)  # raises if missing remotely or wrong bytes
        except Exception as exc:
            corrupted.append(f"{key}: {exc}")
    checks["artifacts_checked"] = checked
    checks["corrupted_or_missing_artifacts"] = corrupted

    errors = [k for k in ("ready_ligand_without_pdbqt", "ready_target_without_receptor_or_box",
                          "duplicate_jobs", "completed_without_result", "result_without_completed_job",
                          "invalid_scores") if checks[k]]
    if corrupted:
        errors.append("corrupted_or_missing_artifacts")
    checks["ok"] = not errors
    checks["errors"] = errors
    checks["warnings"] = [k for k in ("stale_running_jobs", "orphan_jobs_in_cancelled_runs",
                                      "targets_not_ready") if checks[k]]
    return checks


# ---------------------------------------------------------------------------
# Redocking RMSD
# ---------------------------------------------------------------------------

def pose_rmsds(pose_pdbqt: str, reference, top_n: int = REDOCK_TOP_N) -> list[float]:
    """Symmetry-aware heavy-atom RMSD of each of the top poses to the reference, in place."""
    from meeko import PDBQTMolecule, RDKitMolCreate
    from rdkit import Chem
    from rdkit.Chem import rdMolAlign
    pmol = PDBQTMolecule(pose_pdbqt, is_dlg=False, skip_typing=True)
    mol = RDKitMolCreate.from_pdbqt_mol(pmol)[0]
    probe = Chem.RemoveHs(mol)
    ref = Chem.RemoveHs(reference)
    conf_ids = [c.GetId() for c in probe.GetConformers()][:top_n]
    return [float(rdMolAlign.CalcRMS(probe, ref, prbId=cid)) for cid in conf_ids]


# ---------------------------------------------------------------------------
# Validation run
# ---------------------------------------------------------------------------

def validation_run(conn, settings: Settings, params: DockingParameters) -> dict[str, Any]:
    from ..config import load_config
    from ..ingestion.http import HttpClient
    from .worker import Worker

    store = ArtifactStore(settings)
    http = HttpClient(load_config())
    report: dict[str, Any] = {"redock": {}, "known_pairs": {}, "checks": {}}
    try:
        # 1. reference ligands from the CCD, prepared with the same protocol
        refs = {}
        inputs = []
        for target_id, (code, chain) in REDOCK.items():
            smi = ccd_smiles(code, http)
            refs[target_id] = (code, chain, smi)
            inputs.append(LigandInput(f"ccd:{code}", None, f"{code} (co-crystallised ligand)", smi, None,
                                      f"RCSB Chemical Component Dictionary {code} ideal coordinates "
                                      "(bond orders only; geometry regenerated)"))
        prepare_ligands(conn, store, params, inputs, processes=2)

        known_ids = []
        for name, target_id in KNOWN_PAIRS:
            row = conn.execute(
                """select l.ligand_id from docking.ligands l where upper(l.name) = %s
                     and l.preparation_status = 'READY' limit 1""", (name,)).fetchone()
            if row:
                known_ids.append((row[0], target_id, name))
            else:
                report["known_pairs"][f"{name}/{target_id}"] = "not in the library or not prepared"

        run_id = q.create_run(conn, params, kind="validation", name="Validation: redocking + known pairs")
        for target_id in REDOCK:
            q.enqueue(conn, run_id, params.config_hash, [f"ccd:{REDOCK[target_id][0]}"], [target_id])
        for lig, tgt, _ in known_ids:
            q.enqueue(conn, run_id, params.config_hash, [lig], [tgt])
        n_jobs = conn.execute("select count(*) from docking.jobs where run_id=%s", (run_id,)).fetchone()[0]
        report["run_id"] = run_id
        report["jobs_created"] = int(n_jobs)

        # 2. run them with a real worker, restricted to this run
        Worker(settings, params, run_id=run_id, idle_exit_seconds=20).run()

        # 3. results
        rows = conn.execute(
            """select j.id, j.ligand_id, j.target_id, j.status, j.error_message, r.best_affinity,
                      r.poses_count, a.object_key, a.sha256
                 from docking.jobs j left join docking.results r on r.job_id = j.id
                 left join docking.artifacts a on a.id = r.pose_artifact_id
                where j.config_hash = %s and (j.run_id = %s or (j.ligand_id, j.target_id) in
                      (select x, y from unnest(%s::text[], %s::text[]) as t(x, y)))""",
            (params.config_hash, run_id, [k[0] for k in known_ids] or [""],
             [k[1] for k in known_ids] or [""])).fetchall()
        all_completed = all(r[3] == "COMPLETED" for r in rows) and len(rows) > 0
        report["checks"]["all_jobs_completed"] = all_completed
        report["checks"]["jobs"] = [
            {"job": r[0], "ligand": r[1], "target": r[2], "status": r[3], "error": r[4],
             "best_affinity": r[5], "poses": r[6]} for r in rows]

        redock_pass = True
        for target_id, (code, chain, smi) in refs.items():
            row = next((r for r in rows if r[1] == f"ccd:{code}" and r[2] == target_id), None)
            if not row or row[3] != "COMPLETED":
                report["redock"][target_id] = {"ligand": code, "passed": False, "reason": "job did not complete"}
                redock_pass = False
                continue
            pose_text = store.fetch(row[7], row[8]).read_text(encoding="utf-8")
            src = conn.execute(
                """select a.object_key, a.sha256 from docking.targets t join docking.artifacts a
                     on a.id = t.source_artifact_id where t.target_id = %s""", (target_id,)).fetchone()
            pdb_text = store.fetch(src[0], src[1]).read_text(encoding="utf-8")
            ref = crystal_ligand(pdb_text, code, chain, smi)
            rmsds = pose_rmsds(pose_text, ref)
            ok = min(rmsds) <= REDOCK_RMSD_THRESHOLD
            redock_pass &= ok
            report["redock"][target_id] = {
                "ligand": code, "best_affinity": row[5], "rmsd_top_poses": [round(x, 2) for x in rmsds],
                "best_pose_rmsd": round(rmsds[0], 2), "threshold": REDOCK_RMSD_THRESHOLD,
                "passed": ok}
        for lig, tgt, name in known_ids:
            row = next((r for r in rows if r[1] == lig and r[2] == tgt), None)
            report["known_pairs"][f"{name}/{tgt}"] = (
                {"best_affinity": row[5], "poses": row[6]} if row and row[3] == "COMPLETED"
                else {"status": row[3] if row else "missing", "error": row[4] if row else None})

        # 4. duplicate prevention: enqueueing the same pairs again creates nothing
        pairs = [(f"ccd:{REDOCK[t][0]}", t) for t in REDOCK] + [(lig, tgt) for lig, tgt, _ in known_ids]
        again = {"created": q.enqueue_pairs(conn, run_id, params.config_hash, pairs)}
        report["checks"]["reenqueue_created"] = again["created"]
        qc_result = qc(conn, store, params.config_hash)
        report["checks"]["qc_ok"] = qc_result["ok"]
        report["checks"]["qc_errors"] = qc_result["errors"]

        passed = (all_completed and redock_pass and again["created"] == 0 and qc_result["ok"])
        report["passed"] = passed
        conn.execute(
            """update docking.runs set validation_passed=%s, validation_report=%s,
                   status=%s, completed_at=now() where run_id=%s""",
            (passed, json.dumps(report, default=str), "COMPLETED" if passed else "FAILED", run_id))
        q.refresh_run_snapshot(conn, run_id)
        return report
    finally:
        http.close()
        store.close()


def latest_validation(conn, config_hash: str) -> tuple[str, bool] | None:
    row = conn.execute(
        """select run_id, validation_passed from docking.runs where kind='validation' and config_hash=%s
            order by created_at desc limit 1""", (config_hash,)).fetchone()
    return (row[0], bool(row[1])) if row else None
