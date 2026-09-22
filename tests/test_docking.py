"""Docking: target configuration, binding-site derivation, ligand prep, output parsing.

The Vina executable itself is exercised only when it is available; the parsing
and preparation logic is always tested.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.docking.ligand import LigandPreparationError, prepare_ligand
from src.docking.receptor import (
    ReceptorPreparationError,
    TargetSpec,
    compute_box_center,
    load_targets,
)
from src.docking.vina_runner import parse_vina_output

from tests.helpers import SMILES

# A minimal PDB fragment: one ligand residue and a few protein atoms, with
# coordinates chosen so the expected centroid is exact.
MINI_PDB = "\n".join(
    [
        "ATOM      1  N   ALA A  70      10.000  10.000  10.000  1.00 20.00           N",
        "ATOM      2  CA  ALA A  70      12.000  10.000  10.000  1.00 20.00           C",
        "ATOM      3  N   LYS A  73      10.000  14.000  10.000  1.00 20.00           N",
        "ATOM      4  CA  LYS A  73      12.000  14.000  10.000  1.00 20.00           C",
        "ATOM      5  CA  GLY A  99      99.000  99.000  99.000  1.00 20.00           C",
        "HETATM    6  C1  LIG A 300       0.000   0.000   0.000  1.00 20.00           C",
        "HETATM    7  C2  LIG A 300       2.000   4.000   6.000  1.00 20.00           C",
        "HETATM    8  O   HOH A 400      50.000  50.000  50.000  1.00 20.00           O",
        "END",
    ]
)


def _target(**overrides) -> TargetSpec:
    base = dict(
        target_key="test_target", pathogen_key="mrsa", name="Test protein",
        pdb_id="TEST", chain="A", site_mode="ligand", site_reference="LIG",
    )
    base.update(overrides)
    return TargetSpec(**base)


class TestTargetConfiguration:
    def test_shipped_targets_cover_every_pathogen(self, cfg):
        targets, box = load_targets()
        covered = {t.pathogen_key for t in targets}
        assert covered == {p.key for p in cfg.pathogens}
        assert len(box) == 3

    def test_every_target_declares_a_reproducible_site(self):
        targets, _ = load_targets()
        for target in targets:
            assert target.site_mode in {"ligand", "residues"}
            assert target.site_reference
            assert target.pdb_id and target.chain
            assert target.selection_notes, f"{target.target_key} has no recorded rationale"

    def test_structure_url_points_at_rcsb(self):
        assert _target().structure_url == "https://files.rcsb.org/download/TEST.pdb"


class TestBindingSite:
    def test_ligand_mode_centres_on_the_co_crystallised_ligand(self):
        centre, note = compute_box_center(MINI_PDB, _target())
        assert centre == pytest.approx((1.0, 2.0, 3.0))
        assert "LIG" in note

    def test_ligand_mode_ignores_water(self):
        centre, _ = compute_box_center(MINI_PDB, _target())
        # The HOH at (50,50,50) would drag the centroid if it were included.
        assert max(centre) < 10

    def test_residue_mode_centres_on_the_named_residues(self):
        centre, note = compute_box_center(
            MINI_PDB, _target(site_mode="residues", site_reference="70,73")
        )
        assert centre == pytest.approx((11.0, 12.0, 10.0))
        assert "70" in note and "73" in note

    def test_missing_ligand_fails_loudly(self):
        with pytest.raises(ReceptorPreparationError, match="not found"):
            compute_box_center(MINI_PDB, _target(site_reference="XXX"))

    def test_missing_residue_fails_loudly(self):
        """A silently shifted box would produce plausible but meaningless scores."""
        with pytest.raises(ReceptorPreparationError, match="absent"):
            compute_box_center(MINI_PDB, _target(site_mode="residues", site_reference="70,999"))

    def test_wrong_chain_fails(self):
        with pytest.raises(ReceptorPreparationError):
            compute_box_center(MINI_PDB, _target(chain="B"))

    def test_unknown_site_mode_is_rejected(self):
        with pytest.raises(ReceptorPreparationError, match="site_mode"):
            compute_box_center(MINI_PDB, _target(site_mode="guess"))


VINA_STDOUT = """
mode |   affinity | dist from best mode
     | (kcal/mol) | rmsd l.b.| rmsd u.b.
-----+------------+----------+----------
   1       -7.646          0          0
   2       -7.593    0.07956      2.738
   3       -6.425       1.94      2.529
"""


class TestVinaOutputParsing:
    def test_poses_are_parsed_in_rank_order(self):
        poses = parse_vina_output(VINA_STDOUT)
        assert [p.rank for p in poses] == [1, 2, 3]
        assert poses[0].score_kcal_mol == pytest.approx(-7.646)
        assert poses[1].rmsd_ub == pytest.approx(2.738)

    def test_output_without_a_pose_table_yields_nothing(self):
        assert parse_vina_output("Vina failed to find any pose") == []

    def test_empty_output_yields_nothing(self):
        assert parse_vina_output("") == []

    def test_header_lines_are_not_mistaken_for_poses(self):
        poses = parse_vina_output(VINA_STDOUT)
        assert all(p.score_kcal_mol < 0 for p in poses)


class TestLigandPreparation:
    def test_valid_smiles_produces_a_pdbqt(self, tmp_path):
        out = prepare_ligand(SMILES["aspirin"], tmp_path / "aspirin.pdbqt", seed=42)
        text = out.read_text()
        assert out.exists()
        assert "ATOM" in text or "ROOT" in text

    def test_preparation_is_reproducible_for_a_fixed_seed(self, tmp_path):
        a = prepare_ligand(SMILES["ibuprofen"], tmp_path / "a.pdbqt", seed=7).read_text()
        b = prepare_ligand(SMILES["ibuprofen"], tmp_path / "b.pdbqt", seed=7).read_text()
        assert a == b

    def test_invalid_smiles_raises_a_typed_error(self, tmp_path):
        with pytest.raises(LigandPreparationError, match="could not parse"):
            prepare_ligand(SMILES["invalid"], tmp_path / "bad.pdbqt")

    def test_empty_smiles_raises(self, tmp_path):
        with pytest.raises(LigandPreparationError, match="empty"):
            prepare_ligand("", tmp_path / "empty.pdbqt")

    def test_a_larger_drug_still_prepares(self, tmp_path):
        out = prepare_ligand(SMILES["ciprofloxacin"], tmp_path / "cipro.pdbqt", seed=1)
        assert out.stat().st_size > 0


class TestVinaExecutable:
    """Runs only when a Vina binary is actually present."""

    def test_binary_resolution_reports_availability_honestly(self, cfg):
        binary = cfg.resolve_vina_binary()
        assert binary is None or Path(binary).exists()

    def test_version_string_is_recorded(self, cfg):
        binary = cfg.resolve_vina_binary()
        if binary is None:
            pytest.skip("AutoDock Vina is not installed in this environment")
        from src.docking.vina_runner import vina_version

        assert "Vina" in vina_version(binary)


class TestLigandFlexibilityGuard:
    """Very large, very flexible ligands are excluded, with the reason recorded.

    Vina's stochastic search degrades with ligand flexibility; a glycopeptide
    such as oritavancin can run for hours and still not produce a trustworthy
    pose. Reporting reduced coverage is more honest than reporting a number
    nobody should rely on.
    """

    def _seed(self, db, cfg):
        from src.db import utcnow
        from src.ml import registry
        from tests.helpers import SMILES, insert_molecule

        pathogen = "mrsa"
        registry.register_model(
            db, model_version="RF-guard-v1", pathogen_key=pathogen,
            model_type="random_forest", is_baseline=True, dataset_version="DS-test",
            feature_version="morgan-r2-1024-v1", validation_method="test",
            split_method="scaffold", random_seed=42, n_train=10, n_validation=2,
            n_test=3, metrics={"pr_auc": 0.9}, cv_metrics=None, selection_reason="test",
            artifact_path=None, status=registry.STATE_ACTIVE, library_versions={},
        )

        # A compact drug that should be dockable, and a very flexible chain that
        # should not be.
        small = insert_molecule(db, cfg, SMILES["ciprofloxacin"], pref_name="ciprofloxacin")
        huge = insert_molecule(db, cfg, "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCO",
                               pref_name="long-chain")
        for molecule_id in (small, huge):
            db.execute(
                """INSERT INTO predictions(molecule_id, pathogen_key, probability,
                       model_version, model_type, dataset_version, feature_version,
                       predicted_at) VALUES(?,?,?,?,?,?,?,?)""",
                (molecule_id, pathogen, 0.95, "RF-guard-v1", "random_forest",
                 "DS-test", "morgan-r2-1024-v1", utcnow()),
            )
        db.commit()
        return small, huge

    def test_flexible_ligand_is_excluded_and_counted(self, db, cfg):
        from src.pipeline.dock import candidates_for_target, count_excluded_by_size

        small, huge = self._seed(db, cfg)
        target = _target(pathogen_key="mrsa")

        selected = {r["molecule_id"] for r in candidates_for_target(db, cfg, target, 10)}
        assert small in selected
        assert huge not in selected
        assert count_excluded_by_size(db, cfg, target) == 1

    def test_already_docked_compounds_are_not_redocked(self, db, cfg):
        from src.db import utcnow
        from src.pipeline.dock import candidates_for_target

        small, _ = self._seed(db, cfg)
        target = _target(pathogen_key="mrsa")

        # The target row has to exist first: docking_runs references it.
        db.execute(
            """INSERT INTO targets(target_key, pathogen_key, name, pdb_id, chain,
                   site_mode, site_reference) VALUES(?,?,?,?,?,?,?)""",
            (target.target_key, "mrsa", target.name, target.pdb_id, target.chain,
             target.site_mode, target.site_reference),
        )
        db.execute(
            """INSERT INTO docking_runs(run_id, target_key, pathogen_key, engine,
                   started_at, status) VALUES('R1', ?, 'mrsa', 'AutoDock Vina', ?, 'SUCCESS')""",
            (target.target_key, utcnow()),
        )
        db.execute(
            """INSERT INTO docking_results(run_id, molecule_id, target_key, pathogen_key,
                   pose_rank, score_kcal_mol, status, created_at)
               VALUES('R1', ?, ?, 'mrsa', 1, -8.2, 'ok', ?)""",
            (small, target.target_key, utcnow()),
        )
        db.commit()

        remaining = {r["molecule_id"] for r in candidates_for_target(db, cfg, target, 10)}
        assert small not in remaining


class TestStaleRunRecovery:
    def test_interrupted_runs_are_closed_and_their_poses_kept(self, db, cfg):
        """A killed process must not leave the dashboard claiming work is running."""
        from src.db import utcnow
        from src.pipeline.dock import mark_stale_runs
        from tests.helpers import SMILES, insert_molecule

        molecule_id = insert_molecule(db, cfg, SMILES["aspirin"])
        db.execute(
            """INSERT INTO targets(target_key, pathogen_key, name, pdb_id, chain,
                   site_mode, site_reference)
               VALUES('t1','mrsa','Test','TEST','A','ligand','LIG')"""
        )
        db.execute(
            """INSERT INTO docking_runs(run_id, target_key, pathogen_key, engine,
                   started_at, status) VALUES('R1','t1','mrsa','AutoDock Vina',?,'RUNNING')""",
            (utcnow(),),
        )
        db.execute(
            """INSERT INTO docking_results(run_id, molecule_id, target_key, pathogen_key,
                   pose_rank, score_kcal_mol, status, created_at)
               VALUES('R1', ?, 't1', 'mrsa', 1, -8.4, 'ok', ?)""",
            (molecule_id, utcnow()),
        )
        db.commit()

        assert mark_stale_runs(db) == 1

        run = db.execute("SELECT * FROM docking_runs WHERE run_id='R1'").fetchone()
        assert run["status"] == "INTERRUPTED"
        assert run["finished_at"] is not None
        assert "process ended" in run["error"]

        # The scored pose is a real result and must survive.
        pose = db.execute("SELECT * FROM docking_results WHERE run_id='R1'").fetchone()
        assert pose["score_kcal_mol"] == -8.4
        assert pose["status"] == "ok"

    def test_completed_runs_are_untouched(self, db, cfg):
        from src.db import utcnow
        from src.pipeline.dock import mark_stale_runs

        db.execute(
            """INSERT INTO targets(target_key, pathogen_key, name, pdb_id, chain,
                   site_mode, site_reference)
               VALUES('t1','mrsa','Test','TEST','A','ligand','LIG')"""
        )
        db.execute(
            """INSERT INTO docking_runs(run_id, target_key, pathogen_key, engine,
                   started_at, finished_at, status)
               VALUES('R1','t1','mrsa','AutoDock Vina',?,?,'SUCCESS')""",
            (utcnow(), utcnow()),
        )
        db.commit()

        assert mark_stale_runs(db) == 0
        assert db.execute("SELECT status FROM docking_runs").fetchone()["status"] == "SUCCESS"


class TestReceptorPreparationRobustness:
    """Real structures carry alternate conformations and incomplete residues.

    Both of these caused preparation to fail outright during development
    (1RX2 residue A:116 has an altloc; 4TZK residue A:2 is an incomplete THR).
    The command has to handle them deterministically, and must still fail loudly
    when the damaged residue sits in the binding site.
    """

    def test_preparation_command_resolves_altlocs_and_bad_residues(self, cfg, tmp_path, monkeypatch):
        import subprocess

        from src.docking import receptor as receptor_module

        captured: dict[str, list[str]] = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            # Emulate mk_prepare_receptor writing its output file.
            out_base = cmd[cmd.index("-o") + 1]
            Path(f"{out_base}.pdbqt").write_text("ATOM\n", encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        monkeypatch.setattr(receptor_module.subprocess, "run", fake_run)

        target = _target()
        structure = tmp_path / "TEST.pdb"
        structure.write_text(MINI_PDB, encoding="utf-8")
        monkeypatch.setattr(receptor_module, "fetch_structure", lambda *a, **k: structure)

        result = receptor_module.prepare_receptor(cfg, target, cache_dir=tmp_path, force=True)

        cmd = captured["cmd"]
        assert "--default_altloc" in cmd, "altlocs must be resolved deterministically"
        assert "--delete_bad_res_from_box_radius" in cmd, "untypeable residues must be handled"
        # The radius must be finite: deleting bad residues everywhere would let a
        # broken residue inside the binding site pass unnoticed.
        radius = float(cmd[cmd.index("--delete_bad_res_from_box_radius") + 1])
        assert radius > 0
        assert result.box_center == pytest.approx((1.0, 2.0, 3.0))

    def test_preparation_failure_is_raised_not_swallowed(self, cfg, tmp_path, monkeypatch):
        import subprocess

        from src.docking import receptor as receptor_module

        def failing_run(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="template mismatch")

        monkeypatch.setattr(receptor_module.subprocess, "run", failing_run)
        structure = tmp_path / "TEST.pdb"
        structure.write_text(MINI_PDB, encoding="utf-8")
        monkeypatch.setattr(receptor_module, "fetch_structure", lambda *a, **k: structure)

        with pytest.raises(ReceptorPreparationError, match="mk_prepare_receptor failed"):
            receptor_module.prepare_receptor(cfg, _target(), cache_dir=tmp_path, force=True)
