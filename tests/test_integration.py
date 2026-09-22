"""Integration and end-to-end tests.

The external services are replaced with deterministic fakes, so the whole
pipeline runs offline: ingestion, processing, labelling, dataset versioning,
training, promotion and screening.
"""

from __future__ import annotations

import numpy as np
import pytest
from rdkit import Chem

from src.db import table_count, utcnow
from src.ml import registry
from src.ml.dataset import build_pathogen_dataset, create_dataset_version, data_quality_audit
from src.ml.predict import ModelCache, predict_smiles, screen_pathogen
from src.ml.train import train_pathogen
from src.pipeline.process import label_bioactivity, process_molecules
from src.pipeline.runlog import stage_run
from src.pipeline.train import retraining_status

from tests.helpers import SMILES, generate_series, insert_bioactivity, insert_molecule


def _seed_labelled(db, cfg, pathogen_key: str, *, limit: int = 280,
                   force_label: int | None = None) -> int:
    """Insert a labelled chemical series large enough to clear the training gates."""
    made = 0
    for index, (smiles, label) in enumerate(generate_series(limit)):
        if force_label is not None:
            label = force_label
        try:
            molecule_id = insert_molecule(
                db, cfg, smiles, chembl_id=f"CHEMBL_S{index}", pref_name=f"series-{index}"
            )
        except AssertionError:
            continue
        insert_bioactivity(
            db, molecule_id, pathogen_key, label=label,
            pactivity=6.8 if label else 3.1, activity_id=f"series-act-{index}",
        )
        made += 1
    db.commit()
    return made


@pytest.fixture
def trained_db(db, cfg, tmp_path):
    """A database carrying a trained, promoted model for the first pathogen."""
    pathogen = cfg.pathogens[0].key
    _seed_labelled(db, cfg, pathogen)

    ds = build_pathogen_dataset(db, cfg, pathogen)
    assert ds.trainable, ds.reason
    dataset_version = create_dataset_version(db, cfg, {pathogen: ds})
    result = train_pathogen(db, cfg, ds, dataset_version, benchmark=True,
                            models_dir=tmp_path / "models")
    return db, pathogen, dataset_version, result


class TestProcessingStage:
    def test_fingerprints_and_descriptors_are_computed_for_new_molecules(self, db, cfg):
        db.execute(
            """INSERT INTO molecules(molecule_id, canonical_smiles, is_valid, created_at, updated_at)
               VALUES('TEST-1', ?, 1, ?, ?)""",
            (SMILES["aspirin"], utcnow(), utcnow()),
        )
        db.commit()

        with stage_run(db, "process") as run:
            process_molecules(db, cfg, run)

        row = db.execute("SELECT * FROM molecules WHERE molecule_id='TEST-1'").fetchone()
        assert row["fingerprint"] is not None
        assert row["mw"] == pytest.approx(180.16, abs=0.05)
        assert row["feature_version"] == cfg.get("ml", "feature_version")

    def test_processing_is_incremental(self, db, cfg):
        db.execute(
            """INSERT INTO molecules(molecule_id, canonical_smiles, is_valid, created_at, updated_at)
               VALUES('TEST-1', ?, 1, ?, ?)""",
            (SMILES["aspirin"], utcnow(), utcnow()),
        )
        db.commit()
        with stage_run(db, "process") as first:
            process_molecules(db, cfg, first)
        with stage_run(db, "process") as second:
            process_molecules(db, cfg, second)
        assert first.new == 1
        assert second.new == 0, "an unchanged molecule was recomputed"

    def test_labelling_populates_pactivity_and_label(self, db, cfg):
        mid = insert_molecule(db, cfg, SMILES["trimethoprim"])
        db.execute(
            """INSERT INTO bioactivity(source_activity_id, source, molecule_id, pathogen_key,
                   activity_type, activity_value, activity_units, activity_relation, created_at)
               VALUES('A1','ChEMBL',?,?,'MIC',0.5,'ug.mL-1','=',?)""",
            (mid, cfg.pathogens[0].key, utcnow()),
        )
        db.commit()

        with stage_run(db, "process") as run:
            label_bioactivity(db, cfg, run)

        row = db.execute("SELECT * FROM bioactivity WHERE source_activity_id='A1'").fetchone()
        assert row["pactivity"] is not None
        assert row["label"] == 1
        assert "MW=" in row["pactivity_method"]

    def test_unusable_measurement_is_stored_unlabelled_with_a_reason(self, db, cfg):
        mid = insert_molecule(db, cfg, SMILES["aspirin"])
        db.execute(
            """INSERT INTO bioactivity(source_activity_id, source, molecule_id, pathogen_key,
                   activity_type, activity_value, activity_units, activity_relation, created_at)
               VALUES('A2','ChEMBL',?,?,'MIC',10,'percent','=',?)""",
            (mid, cfg.pathogens[0].key, utcnow()),
        )
        db.commit()
        with stage_run(db, "process") as run:
            label_bioactivity(db, cfg, run)
        row = db.execute("SELECT * FROM bioactivity WHERE source_activity_id='A2'").fetchone()
        assert row["label"] is None
        assert "unsupported units" in row["label_reason"]


class TestDatasetConstruction:
    def test_insufficient_data_is_reported_not_fabricated(self, db, cfg):
        """A pathogen without enough data must not get a model."""
        mid = insert_molecule(db, cfg, SMILES["aspirin"])
        insert_bioactivity(db, mid, cfg.pathogens[0].key, label=1)
        ds = build_pathogen_dataset(db, cfg, cfg.pathogens[0].key)
        assert not ds.trainable
        assert "below" in ds.reason

    def test_no_data_at_all_is_reported_clearly(self, db, cfg):
        ds = build_pathogen_dataset(db, cfg, cfg.pathogens[1].key)
        assert not ds.trainable
        assert ds.n == 0
        assert "no labelled bioactivity" in ds.reason

    def test_single_class_data_is_refused(self, db, cfg):
        """Plenty of rows, but only one class: still not trainable."""
        pathogen = cfg.pathogens[0].key
        _seed_labelled(db, cfg, pathogen, force_label=1)
        ds = build_pathogen_dataset(db, cfg, pathogen)
        assert ds.n >= int(cfg.get("labeling", "min_records_per_pathogen"))
        assert not ds.trainable
        assert "minority class" in ds.reason

    def test_repeat_measurements_collapse_to_one_row_per_compound(self, db, cfg):
        pathogen = cfg.pathogens[0].key
        mid = insert_molecule(db, cfg, SMILES["trimethoprim"])
        for i, pact in enumerate((6.0, 6.4, 9.9)):
            insert_bioactivity(db, mid, pathogen, label=1, pactivity=pact, activity_id=f"dup-{i}")
        ds = build_pathogen_dataset(db, cfg, pathogen)
        assert ds.molecule_ids.count(mid) == 1
        assert ds.pactivities[0] == pytest.approx(6.4)  # median, not the outlier
        assert ds.n_measurements[0] == 3

    def test_dataset_version_is_content_addressed_and_stable(self, db, cfg):
        pathogen = cfg.pathogens[0].key
        _seed_labelled(db, cfg, pathogen)
        ds = build_pathogen_dataset(db, cfg, pathogen)
        v1 = create_dataset_version(db, cfg, {pathogen: ds})
        v2 = create_dataset_version(db, cfg, {pathogen: ds})
        assert v1 == v2
        assert table_count(db, "dataset_versions") == 1

    def test_quality_audit_counts_what_is_actually_stored(self, db, cfg):
        mid = insert_molecule(db, cfg, SMILES["aspirin"])
        insert_bioactivity(db, mid, cfg.pathogens[0].key, label=1)
        audit = data_quality_audit(db, cfg)
        assert audit["molecules_valid"] == 1
        assert audit["bioactivity_labelled"] == 1
        assert len(audit["per_pathogen"]) == len(cfg.pathogens)


class TestTrainingIntegration:
    def test_baseline_random_forest_is_always_trained(self, trained_db):
        _, _, _, result = trained_db
        assert any(c.is_baseline and c.model_key == "random_forest" for c in result.candidates)

    def test_a_model_is_selected_and_recorded(self, trained_db):
        db, pathogen, dataset_version, result = trained_db
        assert result.trained
        assert result.selected_model_version
        row = db.execute(
            "SELECT * FROM model_versions WHERE model_version = ?", (result.selected_model_version,)
        ).fetchone()
        assert row["dataset_version"] == dataset_version
        assert row["feature_version"] == "morgan-r2-1024-v1"

    def test_split_partitions_are_recorded_for_audit(self, trained_db):
        db, pathogen, dataset_version, _ = trained_db
        splits = db.execute(
            "SELECT split, COUNT(*) AS n FROM dataset_members WHERE dataset_version = ? GROUP BY split",
            (dataset_version,),
        ).fetchall()
        assert {r["split"] for r in splits} >= {"train", "test"}

    def test_no_molecule_appears_in_both_train_and_test(self, trained_db):
        _, _, _, result = trained_db
        assert result.leakage["clean"], result.leakage

    def test_benchmark_rows_exist_for_every_trained_candidate(self, trained_db):
        db, pathogen, _, result = trained_db
        rows = db.execute(
            "SELECT model_type, selected FROM model_benchmarks WHERE pathogen_key = ?", (pathogen,)
        ).fetchall()
        assert len(rows) == len(result.candidates)
        assert sum(r["selected"] for r in rows) == 1

    def test_reported_metrics_come_from_the_held_out_test_set(self, trained_db):
        _, _, _, result = trained_db
        selected = next(c for c in result.candidates if c.selected)
        assert selected.test_metrics["n"] == result.split_summary["test"]

    def test_artifacts_are_written_and_loadable(self, trained_db):
        db, _, _, result = trained_db
        row = db.execute(
            "SELECT artifact_path FROM model_versions WHERE model_version = ?",
            (result.selected_model_version,),
        ).fetchone()
        bundle = ModelCache().load(row["artifact_path"])
        assert bundle["n_features"] == 1024
        assert "model" in bundle


class TestScreeningIntegration:
    def test_new_drug_is_screened_without_retraining(self, trained_db, cfg):
        """The core automation rule: a new drug uses the existing model."""
        db, pathogen, _, result = trained_db
        models_before = table_count(db, "model_versions")

        new_id = insert_molecule(db, cfg, SMILES["ciprofloxacin"], pref_name="ciprofloxacin")
        db.execute(
            """INSERT INTO drugs(drug_id, molecule_id, generic_name, approval_source, first_seen_at)
               VALUES('NEW-1', ?, 'ciprofloxacin', 'FDA Orange Book', ?)""",
            (new_id, utcnow()),
        )
        db.commit()

        outcome = screen_pathogen(db, cfg, pathogen, incremental=True)

        assert outcome.n_scored >= 1
        assert table_count(db, "model_versions") == models_before, "screening retrained a model"
        prediction = db.execute(
            "SELECT * FROM predictions WHERE molecule_id = ? AND pathogen_key = ?",
            (new_id, pathogen),
        ).fetchone()
        assert prediction is not None
        assert 0.0 <= prediction["probability"] <= 1.0
        assert prediction["model_version"] == result.selected_model_version

    def test_screening_is_incremental(self, trained_db, cfg):
        db, pathogen, _, _ = trained_db
        mid = insert_molecule(db, cfg, SMILES["ciprofloxacin"])
        db.execute(
            """INSERT INTO drugs(drug_id, molecule_id, generic_name, approval_source, first_seen_at)
               VALUES('NEW-1', ?, 'cipro', 'test', ?)""",
            (mid, utcnow()),
        )
        db.commit()

        first = screen_pathogen(db, cfg, pathogen, incremental=True)
        second = screen_pathogen(db, cfg, pathogen, incremental=True)
        assert first.n_scored >= 1
        assert second.n_scored == 0, "an already-scored molecule was rescored"

    def test_screening_without_an_active_model_reports_why(self, db, cfg):
        outcome = screen_pathogen(db, cfg, cfg.pathogens[0].key)
        assert outcome.n_scored == 0
        assert "no ACTIVE model" in outcome.skipped_reason

    def test_every_prediction_carries_full_provenance(self, trained_db, cfg):
        db, pathogen, dataset_version, _ = trained_db
        mid = insert_molecule(db, cfg, SMILES["ciprofloxacin"])
        db.execute(
            """INSERT INTO drugs(drug_id, molecule_id, generic_name, approval_source, first_seen_at)
               VALUES('NEW-2', ?, 'cipro', 'test', ?)""",
            (mid, utcnow()),
        )
        db.commit()
        screen_pathogen(db, cfg, pathogen)
        row = db.execute("SELECT * FROM predictions WHERE molecule_id = ?", (mid,)).fetchone()
        for field in ("model_version", "model_type", "dataset_version", "feature_version", "predicted_at"):
            assert row[field], f"prediction is missing {field}"

    def test_ad_hoc_prediction_returns_without_storing(self, trained_db, cfg):
        db, _, _, _ = trained_db
        before = table_count(db, "predictions")
        result = predict_smiles(db, cfg, SMILES["naproxen"])
        assert result["ok"]
        assert table_count(db, "predictions") == before

    def test_ad_hoc_prediction_rejects_an_invalid_structure(self, trained_db, cfg):
        db, _, _, _ = trained_db
        result = predict_smiles(db, cfg, SMILES["invalid"])
        assert not result["ok"]
        assert result["error"]


class TestRetrainingPolicy:
    def test_status_reports_no_new_labels_after_training(self, trained_db, cfg):
        db, _, dataset_version, _ = trained_db
        from src.db import set_setting

        labelled = db.execute("SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL").fetchone()[0]
        set_setting(db, "labelled_records_at_last_training", str(labelled))
        set_setting(db, "active_dataset_version", dataset_version)
        db.commit()

        status = retraining_status(db, cfg)
        assert status["new_labelled_records"] == 0
        assert not status["retraining_recommended"]

    def test_new_labelled_data_makes_retraining_due(self, trained_db, cfg):
        db, pathogen, dataset_version, _ = trained_db
        from src.db import set_setting

        labelled = db.execute("SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL").fetchone()[0]
        set_setting(db, "labelled_records_at_last_training", str(labelled))
        db.commit()

        mid = insert_molecule(db, cfg, SMILES["isoniazid"])
        insert_bioactivity(db, mid, pathogen, label=1, activity_id="fresh-label")

        status = retraining_status(db, cfg)
        assert status["new_labelled_records"] == 1
        assert status["retraining_recommended"]

    def test_a_worse_challenger_does_not_displace_the_incumbent(self, trained_db, cfg):
        db, pathogen, _, result = trained_db
        incumbent = registry.get_active_model(db, pathogen)
        assert incumbent is not None

        decision = registry.evaluate_promotion(
            cfg, {"pr_auc": 0.05, "roc_auc": 0.30, "f1": 0.05}, incumbent
        )
        assert not decision.promote
        still_active = registry.get_active_model(db, pathogen)
        assert still_active["model_version"] == incumbent["model_version"]

    def test_a_clearly_better_challenger_is_promoted(self, trained_db, cfg):
        db, pathogen, dataset_version, _ = trained_db

        # Install a deliberately mediocre incumbent so the comparison is
        # meaningful; the model trained on this separable series scores near 1.0.
        registry.register_model(
            db, model_version="RF-weak-v1", pathogen_key=pathogen, model_type="random_forest",
            is_baseline=True, dataset_version=dataset_version,
            feature_version="morgan-r2-1024-v1", validation_method="test",
            split_method="scaffold", random_seed=42, n_train=10, n_validation=2, n_test=3,
            metrics={"pr_auc": 0.45, "roc_auc": 0.65, "f1": 0.4}, cv_metrics=None,
            selection_reason="weak incumbent", artifact_path=None,
            status=registry.STATE_CANDIDATE, library_versions={},
        )
        registry.promote(db, "RF-weak-v1", pathogen, "installed as the incumbent")

        incumbent = registry.get_active_model(db, pathogen)
        assert incumbent["model_version"] == "RF-weak-v1"

        decision = registry.evaluate_promotion(
            cfg, {"pr_auc": 0.90, "roc_auc": 0.93, "f1": 0.85}, incumbent
        )
        assert decision.promote
        assert "improved" in decision.reason


class TestPipelineRunLogging:
    def test_successful_stage_is_recorded(self, db):
        with stage_run(db, "demo") as run:
            run.processed = 5
            run.new = 3
        row = db.execute("SELECT * FROM pipeline_runs WHERE stage='demo'").fetchone()
        assert row["status"] == "SUCCESS"
        assert row["records_processed"] == 5
        assert row["duration_seconds"] is not None

    def test_per_item_errors_do_not_abort_the_stage(self, db):
        with stage_run(db, "demo") as run:
            run.processed = 3
            run.record_error("item-1", ValueError("bad record"))
        row = db.execute("SELECT * FROM pipeline_runs WHERE stage='demo'").fetchone()
        assert row["status"] == "PARTIAL"
        assert row["error_count"] == 1
        error = db.execute("SELECT * FROM pipeline_errors").fetchone()
        assert error["subject"] == "item-1"
        assert error["error_type"] == "ValueError"

    def test_a_raising_stage_is_marked_failed_and_re_raises(self, db):
        with pytest.raises(RuntimeError):
            with stage_run(db, "demo"):
                raise RuntimeError("catastrophe")
        row = db.execute("SELECT * FROM pipeline_runs WHERE stage='demo'").fetchone()
        assert row["status"] == "FAILED"
        assert "catastrophe" in row["message"]


class TestEndToEnd:
    def test_full_chain_from_raw_records_to_ranked_candidates(self, db, cfg, tmp_path):
        """raw data -> process -> train -> predict -> candidates."""
        from src.ranking import rank_candidates

        pathogen = cfg.pathogens[0].key
        _seed_labelled(db, cfg, pathogen)

        with stage_run(db, "process") as run:
            process_molecules(db, cfg, run)
            label_bioactivity(db, cfg, run)

        ds = build_pathogen_dataset(db, cfg, pathogen)
        assert ds.trainable
        dataset_version = create_dataset_version(db, cfg, {pathogen: ds})
        result = train_pathogen(db, cfg, ds, dataset_version, benchmark=False,
                                models_dir=tmp_path / "models")
        assert result.trained

        # Register the training compounds as approved products so they are screened.
        for mid in ds.molecule_ids[:10]:
            db.execute(
                """INSERT INTO drugs(drug_id, molecule_id, generic_name, approval_source,
                       first_seen_at) VALUES(?,?,?,?,?)""",
                (f"D-{mid}", mid, f"drug-{mid[:6]}", "test", utcnow()),
            )
        db.commit()

        outcome = screen_pathogen(db, cfg, pathogen, incremental=True)
        assert outcome.n_scored == 10

        candidates = rank_candidates(db, cfg, pathogen, min_probability=0.0)
        assert not candidates.empty
        assert candidates["composite_score"].notna().all()
        assert candidates["rank"].tolist() == sorted(candidates["rank"].tolist())


class TestResistancePhenotypeCoverage:
    """The project's most consequential caveat must be measured, not just prosed.

    The pathogens are named for resistant organisms, but most published MICs are
    measured on susceptible reference strains. The audit has to quantify that so
    the dashboard can state it instead of implying the stronger claim.
    """

    def _seed_mixed(self, db, cfg, pathogen: str, n_resistant: int, n_total: int) -> None:
        from tests.helpers import generate_series

        for index, (smiles, label) in enumerate(generate_series(n_total)):
            try:
                molecule_id = insert_molecule(db, cfg, smiles, chembl_id=f"CHEMBL_R{index}")
            except AssertionError:
                continue
            db.execute(
                """INSERT INTO bioactivity(source_activity_id, source, molecule_id, pathogen_key,
                       activity_type, activity_value, activity_units, activity_relation,
                       pactivity, pactivity_method, label, label_reason, strain_specific,
                       assay_description, created_at)
                   VALUES(?,'test',?,?,'MIC',1.0,'ug.mL-1','=',?,'test',?,'fixture',?,?,?)""",
                (
                    f"res-{index}", molecule_id, pathogen,
                    6.8 if label else 3.1, label,
                    1 if index < n_resistant else 0,
                    "against MRSA" if index < n_resistant else "against S. aureus",
                    utcnow(),
                ),
            )
        db.commit()

    def test_audit_reports_the_resistant_strain_fraction(self, db, cfg):
        pathogen = cfg.pathogens[0].key
        self._seed_mixed(db, cfg, pathogen, n_resistant=20, n_total=100)

        audit = data_quality_audit(db, cfg)
        entry = next(e for e in audit["per_pathogen"] if e["pathogen"] == pathogen)

        assert entry["resistant_strain_records"] == 20
        assert entry["labelled_records"] == 100
        assert entry["resistant_strain_fraction"] == pytest.approx(0.2)

    def test_low_resistance_coverage_raises_a_sanity_warning(self, db, cfg):
        from src.ml.sanity import SEVERITY_WARNING, check_dataset

        pathogen = cfg.pathogens[0].key
        self._seed_mixed(db, cfg, pathogen, n_resistant=5, n_total=200)

        ds = build_pathogen_dataset(db, cfg, pathogen)
        assert ds.trainable, ds.reason
        dataset_version = create_dataset_version(db, cfg, {pathogen: ds})

        findings = check_dataset(db, dataset_version)
        coverage = [f for f in findings if f.check == "resistance_phenotype_coverage"]
        assert coverage, "low resistant-strain coverage must be flagged"
        assert coverage[0].severity == SEVERITY_WARNING
        assert "antibacterial activity against the species" in coverage[0].message

    def test_full_resistance_coverage_is_not_flagged(self, db, cfg):
        from src.ml.sanity import check_dataset

        pathogen = cfg.pathogens[0].key
        self._seed_mixed(db, cfg, pathogen, n_resistant=200, n_total=200)

        ds = build_pathogen_dataset(db, cfg, pathogen)
        dataset_version = create_dataset_version(db, cfg, {pathogen: ds})

        findings = check_dataset(db, dataset_version)
        assert not [f for f in findings if f.check == "resistance_phenotype_coverage"]

    def test_a_scaffold_in_two_splits_is_reported_as_leakage(self, db, cfg):
        """The guard that stops a stereo-aware scaffold string re-opening leakage."""
        from src.ml.sanity import SEVERITY_CRITICAL, check_dataset

        pathogen = cfg.pathogens[0].key
        self._seed_mixed(db, cfg, pathogen, n_resistant=20, n_total=100)
        ds = build_pathogen_dataset(db, cfg, pathogen)
        dataset_version = create_dataset_version(db, cfg, {pathogen: ds})

        assert not [f for f in check_dataset(db, dataset_version) if f.check == "scaffold_leakage"]

        # Force one scaffold onto both sides of the partition.
        rows = db.execute(
            "SELECT molecule_id, split FROM dataset_members WHERE dataset_version = ?",
            (dataset_version,),
        ).fetchall()
        assert len(rows) >= 2
        a, b = rows[0]["molecule_id"], rows[1]["molecule_id"]
        db.execute(
            "UPDATE dataset_members SET split = 'train' WHERE dataset_version = ? AND molecule_id = ?",
            (dataset_version, a),
        )
        db.execute(
            "UPDATE dataset_members SET split = 'test' WHERE dataset_version = ? AND molecule_id = ?",
            (dataset_version, b),
        )
        db.execute(
            "UPDATE molecules SET murcko_scaffold = 'c1ccccc1' WHERE molecule_id IN (?, ?)",
            (a, b),
        )
        db.commit()

        leaks = [f for f in check_dataset(db, dataset_version) if f.check == "scaffold_leakage"]
        assert leaks, "a scaffold present in two splits must be reported"
        assert leaks[0].severity == SEVERITY_CRITICAL

    def test_assay_text_drives_the_flag_not_the_pathogen_name(self, cfg):
        """A card labelled MRSA must not make susceptible-strain data look resistant."""
        mrsa = cfg.pathogen("mrsa")
        assert mrsa.is_resistant_strain_assay("Activity against MRSA clinical isolates")
        assert mrsa.is_resistant_strain_assay("methicillin-resistant S. aureus ATCC 43300")
        assert not mrsa.is_resistant_strain_assay("Antibacterial activity against S. aureus")
        assert not mrsa.is_resistant_strain_assay(None)
