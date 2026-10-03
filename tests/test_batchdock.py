"""Batch docking: preparation, queue semantics, progress, and a real Vina run.

Database tests need a disposable Postgres (`AMR_TEST_DATABASE_URL`); the
docker compose `docking-test` service provides one. They are skipped, not
faked, when it is absent. The integration test downloads PDB 3FRE and runs
the real AutoDock Vina binary; it is skipped when Vina or the network is not
available.
"""

from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path

import pytest

from src.batchdock import queue as q
from src.batchdock.config import DockingParameters, Settings, load_settings
from src.batchdock.engine import EngineError, parse_and_check
from src.batchdock.prepare import LigandInput, prepare_ligand_files, validate_pdbqt

ROOT = Path(__file__).resolve().parents[1]
TEST_DB = os.environ.get("AMR_TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not TEST_DB, reason="AMR_TEST_DATABASE_URL not set")


def lig(smiles, ligand_id="TEST-L", inchikey=None):
    return LigandInput(ligand_id, ligand_id, "test", smiles, inchikey, "unit test")


# ---------------------------------------------------------------------------
# 1. Ligand preparation
# ---------------------------------------------------------------------------

def test_ligand_preparation_produces_valid_pdbqt():
    o = prepare_ligand_files(lig("COc1cc(Cc2cnc(N)nc2N)cc(OC)c1OC"))  # trimethoprim
    assert o.status == "READY", o.error
    text = o.pdbqt.decode()
    assert validate_pdbqt(text, ligand=True) == []
    assert o.heavy_atoms == 21 and o.torsions is not None and o.torsions > 0
    assert b"$$$$" in o.sdf


def test_ligand_preparation_is_deterministic():
    a = prepare_ligand_files(lig("CC(=O)Oc1ccccc1C(=O)O"))
    b = prepare_ligand_files(lig("CC(=O)Oc1ccccc1C(=O)O"))
    assert a.pdbqt == b.pdbqt


@pytest.mark.parametrize("smiles,status,fragment", [
    ("", "STRUCTURE_UNAVAILABLE", "no chemical structure"),
    (None, "STRUCTURE_UNAVAILABLE", "no chemical structure"),
    ("C1CC(", "LIGAND_PREPARATION_FAILED", "malformed SMILES"),
    ("CCO.Cl", "LIGAND_PREPARATION_FAILED", "more than one component"),
    ("C[Se]CC[C@H](N)C(=O)O", "LIGAND_PREPARATION_FAILED", ""),  # Se: no AutoDock type
])
def test_ligand_failures_are_classified_not_substituted(smiles, status, fragment):
    o = prepare_ligand_files(lig(smiles))
    assert o.status == status
    assert fragment in (o.error or "")
    assert o.pdbqt is None


def test_ligand_identity_mismatch_is_refused():
    o = prepare_ligand_files(lig("CCO", inchikey="BSYNRYMUTXBXSQ-UHFFFAOYSA-N"))  # aspirin's key
    assert o.status == "LIGAND_PREPARATION_FAILED"
    assert "does not match its recorded InChIKey" in o.error


def test_macrocycle_glue_atoms_are_valid():
    o = prepare_ligand_files(lig("NC(=O)N1c2ccccc2CC(=O)c2ccccc21"))  # oxcarbazepine
    assert o.status == "READY", o.error


# ---------------------------------------------------------------------------
# 2. Target / PDBQT validation
# ---------------------------------------------------------------------------

def test_receptor_pdbqt_validation():
    good = ("ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00  0.00    -0.079 N \n"
            "ATOM      2  CA  MET A   1      26.266  25.413   2.842  1.00  0.00     0.181 C \n")
    assert validate_pdbqt(good, ligand=False) == []
    assert validate_pdbqt("", ligand=False) == ["no ATOM/HETATM records"]
    bad = good.replace(" N \n", " Xx\n", 1)
    assert any("cannot score" in p for p in validate_pdbqt(bad, ligand=False))


# ---------------------------------------------------------------------------
# 3. Result parsing
# ---------------------------------------------------------------------------

STDOUT = """mode |   affinity | dist from best mode
-----+------------+----------+----------
   1       -9.631          0          0
   2       -9.029       2.69      7.426
"""
POSES = """MODEL 1
REMARK VINA RESULT:    -9.631      0.000      0.000
ATOM      1  C   UNL     1      30.000  11.000  42.000  1.00  0.00     0.000 C
ENDMDL
MODEL 2
REMARK VINA RESULT:    -9.029      2.690      7.426
ATOM      1  C   UNL     1      31.000  11.000  42.000  1.00  0.00     0.000 C
ENDMDL
"""


def test_result_parsing():
    poses = parse_and_check(STDOUT, POSES, 9)
    assert [p["affinity"] for p in poses] == [-9.631, -9.029]
    assert poses[1]["rmsd_ub"] == 7.426


def test_poses_outside_the_energy_range_are_not_in_the_file():
    # Vina 1.2.5 prints every mode but writes only those within energy_range.
    stdout = STDOUT + "   3       -5.900      3.0      5.0\n"
    assert len(parse_and_check(stdout, POSES, 9, 3.0)) == 2
    with pytest.raises(EngineError, match="within the energy range"):
        parse_and_check(STDOUT + "   3       -8.000      3.0      5.0\n", POSES, 9, 3.0)


def test_result_parsing_accepts_scores_printed_without_decimals():
    # Vina prints -7.000 as "-7"; dropping that line once failed a real job.
    stdout = STDOUT.replace("-9.029       2.69", "-7          2.69")
    poses = POSES.replace("-9.029      2.690", "-7.000      2.690")
    assert [p["affinity"] for p in parse_and_check(stdout, poses, 9)] == [-9.631, -7.0]


@pytest.mark.parametrize("stdout,poses,msg", [
    ("", POSES, "no pose table"),
    (STDOUT, "", "empty or malformed"),
    (STDOUT.replace("-9.029", "-8.000"), POSES, "!= file"),
    (STDOUT + "   3       -8.000      3.0      5.0\n", POSES, "Vina reported"),
])
def test_result_parsing_rejects_inconsistent_output(stdout, poses, msg):
    with pytest.raises(EngineError, match=msg):
        parse_and_check(stdout, poses, 9)


def test_config_hash_tracks_scientific_parameters_only():
    a, b = DockingParameters(), DockingParameters()
    assert a.config_hash == b.config_hash and len(a.config_hash) == 64
    assert DockingParameters(exhaustiveness=16).config_hash != a.config_hash
    assert DockingParameters(seed=1).config_hash != a.config_hash


def test_backoff_is_exponential_and_capped():
    assert [q.backoff_seconds(n) for n in (1, 2, 3)] == [30, 60, 120]
    assert q.backoff_seconds(20) == 900


def test_schema_matches_web_migration():
    mig = ROOT / "web" / "supabase" / "migrations" / "0005_docking_queue.sql"
    if not mig.exists():
        pytest.skip("web migrations not present in this image")
    assert mig.read_text(encoding="utf-8") == q.schema_sql()


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def db():
    conn = q.connect(TEST_DB)
    conn.execute("drop schema if exists docking cascade; drop schema if exists amr cascade")
    conn.execute("""create schema amr;
        create table amr.molecules(molecule_id text primary key, chembl_id text, pref_name text,
            canonical_smiles text, inchikey text, feature_version text);
        create table amr.drugs(drug_id serial primary key, molecule_id text, generic_name text);""")
    q.migrate(conn)
    yield conn
    conn.close()


PARAMS = DockingParameters()


def seed_queue(conn, n_ligands=3, failed_ligand=True, failed_target=False):
    """n READY ligands (+1 failed) x 2 targets, registered directly."""
    for i in range(n_ligands):
        lid = f"L{i}"
        conn.execute("insert into amr.molecules(molecule_id, canonical_smiles) values (%s, 'CCO')", (lid,))
        conn.execute("insert into amr.drugs(molecule_id, generic_name) values (%s, %s)", (lid, lid))
    art = conn.execute("""insert into docking.artifacts(kind, object_key, sha256, size_bytes)
                          values ('x', 'k', %s, 1) returning id""", ("0" * 64,)).fetchone()[0]
    for i in range(n_ligands):
        conn.execute("""insert into docking.ligands(ligand_id, molecule_id, structure_source,
                          preparation_status, pdbqt_artifact_id, torsions, heavy_atoms)
                        values (%s, %s, 'test', 'READY', %s, %s, 10)""", (f"L{i}", f"L{i}", art, i))
    if failed_ligand:
        conn.execute("insert into amr.molecules(molecule_id) values ('LX')")
        conn.execute("insert into amr.drugs(molecule_id) values ('LX')")
        conn.execute("""insert into docking.ligands(ligand_id, molecule_id, structure_source,
                          preparation_status, preparation_error)
                        values ('LX', 'LX', 'test', 'STRUCTURE_UNAVAILABLE', 'no structure')""")
    for t, status in (("T1", "READY"), ("T2", "TARGET_PREPARATION_FAILED" if failed_target else "READY")):
        conn.execute("""insert into docking.targets(target_id, pathogen_key, organism, protein_name,
                          preparation_status, prepared_artifact_id, center_x, center_y, center_z,
                          size_x, size_y, size_z, preparation_error)
                        values (%s, 'p', 'o', 'prot', %s, %s, 0, 0, 0, 22, 22, 22,
                                case when %s = 'READY' then null else 'no site' end)""",
                     (t, status, art if status == "READY" else None, status))
    run = q.create_run(conn, PARAMS, kind="full", name="test")
    return run


# ---------------------------------------------------------------------------
# 4-5. Job creation and duplicate prevention
# ---------------------------------------------------------------------------

@needs_db
def test_job_creation_covers_every_pair_and_classifies_inputs(db):
    run = seed_queue(db, failed_target=True)
    res = q.enqueue(db, run, PARAMS.config_hash)
    assert res["created"] == 4 * 2
    rows = dict(db.execute("select status, count(*) from docking.jobs group by status").fetchall())
    assert rows == {"QUEUED": 3, "STRUCTURE_UNAVAILABLE": 1, "TARGET_PREPARATION_FAILED": 4}


@needs_db
def test_duplicate_prevention(db):
    run = seed_queue(db)
    assert q.enqueue(db, run, PARAMS.config_hash)["created"] == 8
    assert q.enqueue(db, run, PARAMS.config_hash)["created"] == 0
    other = q.create_run(db, PARAMS, kind="full", name="second")
    assert q.enqueue(db, other, PARAMS.config_hash)["created"] == 0
    with pytest.raises(Exception):
        db.execute("""insert into docking.jobs(run_id, ligand_id, target_id, config_hash)
                      values (%s, 'L0', 'T1', %s)""", (run, PARAMS.config_hash))


# ---------------------------------------------------------------------------
# 6. Claiming
# ---------------------------------------------------------------------------

@needs_db
def test_concurrent_claims_never_share_a_job(db):
    run = seed_queue(db, n_ligands=12, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash)
    claimed: list[int] = []
    lock = threading.Lock()

    def grab(w):
        c = q.connect(TEST_DB)
        while True:
            jobs = q.claim(c, f"w{w}", 60)
            if not jobs:
                break
            with lock:
                claimed.extend(j.id for j in jobs)
        c.close()

    threads = [threading.Thread(target=grab, args=(i,)) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(claimed) == 24 and len(set(claimed)) == 24


@needs_db
def test_claim_order_and_paused_runs(db):
    run = seed_queue(db, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash)
    first = q.claim(db, "w", 60)[0]
    assert first.ligand_id == "L0"  # fewest torsions first
    q.set_run_status(db, run, "PAUSED")
    assert q.claim(db, "w", 60) == []


# ---------------------------------------------------------------------------
# 7. Retry logic
# ---------------------------------------------------------------------------

@needs_db
def test_transient_failure_backs_off_then_becomes_terminal(db):
    run = seed_queue(db, n_ligands=1, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash, max_attempts=2)
    job = q.claim(db, "w", 60)[0]
    assert q.fail(db, job, "w", "boom", transient=True) == "QUEUED"
    nb = db.execute("select not_before > now() from docking.jobs where id=%s", (job.id,)).fetchone()[0]
    assert nb  # backoff: not claimable yet
    assert all(j.id != job.id for j in q.claim(db, "w2", 60))
    db.execute("update docking.jobs set not_before = now() - interval '1 second' where id=%s", (job.id,))
    job2 = next(j for j in q.claim(db, "w", 60, limit=5) if j.id == job.id)
    assert job2.attempt_count == 2
    assert q.fail(db, job2, "w", "boom", transient=True) == "DOCKING_FAILED"


@needs_db
def test_retry_failed_requeues_docking_failures_only(db):
    run = seed_queue(db, n_ligands=1)
    q.enqueue(db, run, PARAMS.config_hash)
    job = q.claim(db, "w", 60)[0]
    q.fail(db, job, "w", "timeout", transient=False)
    assert q.retry_failed(db, PARAMS.config_hash) == 1
    st = dict(db.execute("select status, count(*) from docking.jobs group by status").fetchall())
    assert st["STRUCTURE_UNAVAILABLE"] == 2  # input failures untouched
    assert st["QUEUED"] == 2


# ---------------------------------------------------------------------------
# 8. Stale job recovery + lease ownership
# ---------------------------------------------------------------------------

@needs_db
def test_stale_jobs_are_recovered(db):
    run = seed_queue(db, n_ligands=2, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash, max_attempts=1)
    a, b = q.claim(db, "dead", 60, limit=2)
    db.execute("update docking.jobs set max_attempts = 3 where id = %s", (a.id,))
    db.execute("update docking.jobs set lease_expires_at = now() - interval '1 minute'")
    assert q.recover_stale(db) == {"requeued": 1, "failed": 1}
    st = dict(db.execute("select id, status from docking.jobs where id in (%s, %s)", (a.id, b.id)).fetchall())
    assert st == {a.id: "QUEUED", b.id: "FAILED"}


@needs_db
def test_heartbeat_keeps_lease_and_lost_lease_cannot_complete(db):
    run = seed_queue(db, n_ligands=1, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash)
    job = q.claim(db, "w1", 60)[0]
    assert q.heartbeat(db, "w1", [job.id], 60) == 1
    db.execute("update docking.jobs set lease_expires_at = now() - interval '1 s'")
    q.recover_stale(db)
    other = q.claim(db, "w2", 60)[0]
    assert other.id == job.id
    assert q.heartbeat(db, "w1", [job.id], 60) == 0
    fake = {"duration_seconds": 1.0}
    assert q.complete(db, job, "w1", fake) is False
    assert db.execute("select count(*) from docking.results").fetchone()[0] == 0


# ---------------------------------------------------------------------------
# 9-11. Progress, resume, failed jobs
# ---------------------------------------------------------------------------

def _fake_result(art: int) -> dict:
    return {"best_affinity": -7.5, "poses_count": 1, "rmsd_lower_bound": 0.0, "rmsd_upper_bound": 0.0,
            "poses": [{"rank": 1, "affinity": -7.5, "rmsd_lb": 0.0, "rmsd_ub": 0.0}],
            "pose_artifact_id": art, "log_artifact_id": art, "engine": "AutoDock Vina",
            "engine_version": "1.2.5", "exhaustiveness": 8, "num_modes": 9, "energy_range": 3.0,
            "seed": 42, "cpu": 1, "center_x": 0, "center_y": 0, "center_z": 0, "size_x": 22,
            "size_y": 22, "size_z": 22, "receptor_sha256": "0" * 64, "ligand_sha256": "0" * 64,
            "command": "vina ...", "worker_id": "w", "duration_seconds": 12.0}


@needs_db
def test_progress_is_computed_from_jobs(db):
    from src.batchdock.progress import campaign_status
    run = seed_queue(db, n_ligands=3)
    q.enqueue(db, run, PARAMS.config_hash)
    art = db.execute("select id from docking.artifacts limit 1").fetchone()[0]
    jobs = q.claim(db, "w", 60, limit=3)
    # The queue layer accepts this record shape; the numbers are test inputs,
    # never shown anywhere (test database).
    assert q.complete(db, jobs[0], "w", _fake_result(art))
    q.fail(db, jobs[1], "w", "timeout", transient=False)
    s = campaign_status(db, PARAMS.config_hash)
    assert s["medicines"]["total"] == 4
    assert s["targets"]["total"] == 2
    assert s["jobs"]["expected"] == 8 and s["jobs"]["total"] == 8
    assert s["jobs"]["completed"] == 1 and s["jobs"]["dockingFailed"] == 1
    assert s["jobs"]["running"] == 1 and s["jobs"]["queued"] == 3
    assert s["jobs"]["structureUnavailable"] == 2
    assert s["successRate"] == 0.5          # input failures excluded from the denominator
    assert s["etaMinutes"] is None          # < 10 recent completions: no ETA
    assert s["jobs"]["remaining"] == 4
    json.dumps(s)                           # API-serialisable


@needs_db
def test_resume_never_reruns_completed_jobs(db):
    run = seed_queue(db, n_ligands=3, failed_ligand=False)
    q.enqueue(db, run, PARAMS.config_hash)
    art = db.execute("select id from docking.artifacts limit 1").fetchone()[0]
    done = q.claim(db, "w", 60, limit=2)
    for j in done:
        assert q.complete(db, j, "w", _fake_result(art))
    crashed = q.claim(db, "w", 60)[0]
    db.execute("update docking.jobs set lease_expires_at = now() - interval '1 s'")
    q.recover_stale(db)
    assert q.enqueue(db, run, PARAMS.config_hash)["created"] == 0
    remaining = []
    while True:
        js = q.claim(db, "w2", 60)
        if not js:
            break
        remaining += js
    ids = {j.id for j in remaining}
    assert crashed.id in ids
    assert not ids & {j.id for j in done}
    assert len(remaining) == 6 - 2


# ---------------------------------------------------------------------------
# 12. Integration: real target preparation + real AutoDock Vina
# ---------------------------------------------------------------------------

@needs_db
def test_real_docking_end_to_end(db, tmp_path, monkeypatch):
    from src.batchdock.artifacts import ArtifactStore
    from src.batchdock.prepare import prepare_ligands, prepare_targets
    from src.batchdock.progress import campaign_status
    from src.batchdock.worker import Worker

    monkeypatch.setenv("DOCKING_DATABASE_URL", TEST_DB)
    monkeypatch.setenv("DOCKING_ARTIFACT_DIR", str(tmp_path))
    monkeypatch.setenv("DOCKING_CONCURRENCY", "2")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    settings = load_settings()
    if settings.vina_binary is None:
        pytest.skip("AutoDock Vina not installed")
    # A low exhaustiveness keeps the test short. It is a different configuration
    # hash, so nothing produced here could be confused with the campaign's.
    params = DockingParameters(exhaustiveness=2)
    store = ArtifactStore(settings)
    try:
        status = prepare_targets(db, store, params, only=["sa_dhfr"])
    except Exception as exc:
        pytest.skip(f"RCSB not reachable: {exc}")
    assert status == {"sa_dhfr": "READY"}
    site = db.execute("select binding_site_definition from docking.targets where target_id='sa_dhfr'").fetchone()[0]
    assert "cofactor NDP retained" in site
    db.execute("update docking.targets set selected = (target_id = 'sa_dhfr')")
    db.execute("""insert into amr.molecules(molecule_id, chembl_id, canonical_smiles, inchikey, feature_version)
                  values ('IEDVJHCEMCRBQM-UHFFFAOYSA-N', 'CHEMBL22', 'COc1cc(Cc2cnc(N)nc2N)cc(OC)c1OC',
                          'IEDVJHCEMCRBQM-UHFFFAOYSA-N', 'v1'),
                         ('BAD', null, 'C1CC(', null, 'v1')""")
    db.execute("insert into amr.drugs(molecule_id, generic_name) values "
               "('IEDVJHCEMCRBQM-UHFFFAOYSA-N', 'TRIMETHOPRIM'), ('BAD', 'BROKEN')")
    from src.batchdock.prepare import library_ligand_inputs
    counts = prepare_ligands(db, store, params, library_ligand_inputs(db), processes=1)
    assert counts == {"READY": 1, "LIGAND_PREPARATION_FAILED": 1}
    run = q.create_run(db, params, kind="full", name="integration")
    assert q.enqueue(db, run, params.config_hash)["created"] == 2

    Worker(settings, params, idle_exit_seconds=3).run()

    job = db.execute("""select j.status, r.best_affinity, r.poses_count, r.poses, r.engine_version,
                               r.receptor_sha256, a.object_key, a.sha256
                          from docking.jobs j join docking.results r on r.job_id = j.id
                          join docking.artifacts a on a.id = r.pose_artifact_id
                         where j.ligand_id = 'IEDVJHCEMCRBQM-UHFFFAOYSA-N'""").fetchone()
    status, best, n, poses, version, rsha, key, sha = job
    assert status == "COMPLETED" and version == "1.2.5"
    assert math.isfinite(best) and best < 0 and n == len(poses) >= 1
    assert best == poses[0]["affinity"]
    pose = store.fetch(key, sha).read_text()
    assert "REMARK VINA RESULT" in pose
    bad = db.execute("select status, error_message from docking.jobs where ligand_id='BAD'").fetchone()
    assert bad[0] == "LIGAND_PREPARATION_FAILED" and "malformed" in bad[1]
    s = campaign_status(db, params.config_hash)
    assert s["jobs"]["completed"] == 1 and s["jobs"]["ligandPreparationFailed"] == 1
    assert s["jobs"]["remaining"] == 0
