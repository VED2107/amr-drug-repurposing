"""Candidate ranking, database schema guarantees and provenance."""

from __future__ import annotations

import pytest

from src.db import get_setting, record_source, set_setting, table_count, utcnow
from src.ml import registry
from src.ranking import CANDIDATE_LANGUAGE, composite_score, rank_candidates, score_components

from tests.helpers import SMILES, insert_molecule


class TestScoreComponents:
    def test_all_evidence_present_normalises_to_unit_range(self, cfg):
        parts = score_components(
            ml_probability=0.9, docking_score=-9.0, lipinski_violations=0,
            n_clinical_trials=10, cfg=cfg,
        )
        assert all(0.0 <= v <= 1.0 for v in parts.values())
        assert parts["ml_probability"] == 0.9
        assert parts["drug_likeness"] == 1.0
        assert parts["clinical_history"] == 1.0

    def test_missing_evidence_stays_none_and_is_not_zero(self, cfg):
        """A compound that has not been docked must not look like a bad docker."""
        parts = score_components(
            ml_probability=0.8, docking_score=None, lipinski_violations=None,
            n_clinical_trials=None, cfg=cfg,
        )
        assert parts["docking"] is None
        assert parts["drug_likeness"] is None
        assert parts["clinical_history"] is None

    def test_docking_normalisation_is_monotonic_in_the_right_direction(self, cfg):
        """More negative Vina scores are better and must normalise higher."""
        tight = score_components(ml_probability=None, docking_score=-11.0,
                                 lipinski_violations=None, n_clinical_trials=None, cfg=cfg)
        loose = score_components(ml_probability=None, docking_score=-5.0,
                                 lipinski_violations=None, n_clinical_trials=None, cfg=cfg)
        assert tight["docking"] > loose["docking"]

    def test_docking_normalisation_clamps_beyond_the_configured_range(self, cfg):
        extreme = score_components(ml_probability=None, docking_score=-30.0,
                                   lipinski_violations=None, n_clinical_trials=None, cfg=cfg)
        assert extreme["docking"] == 1.0

    def test_drug_likeness_decreases_with_violations(self, cfg):
        values = [
            score_components(ml_probability=None, docking_score=None,
                             lipinski_violations=v, n_clinical_trials=None, cfg=cfg)["drug_likeness"]
            for v in range(5)
        ]
        assert values == sorted(values, reverse=True)
        assert values[0] == 1.0 and values[4] == 0.0

    def test_zero_trials_is_zero_but_not_missing(self, cfg):
        parts = score_components(ml_probability=None, docking_score=None,
                                 lipinski_violations=None, n_clinical_trials=0, cfg=cfg)
        assert parts["clinical_history"] == 0.0


class TestCompositeScore:
    def test_weights_renormalise_over_available_evidence(self, cfg):
        only_ml = composite_score({"ml_probability": 0.8, "docking": None,
                                   "drug_likeness": None, "clinical_history": None}, cfg)
        assert only_ml["score"] == pytest.approx(0.8)
        assert only_ml["components_used"] == ["ml_probability"]
        assert only_ml["evidence_weight"] < 1.0

    def test_full_evidence_reports_complete_coverage(self, cfg):
        full = composite_score({"ml_probability": 1.0, "docking": 1.0,
                                "drug_likeness": 1.0, "clinical_history": 1.0}, cfg)
        assert full["score"] == pytest.approx(1.0)
        assert full["evidence_weight"] == pytest.approx(1.0)

    def test_no_evidence_yields_no_score_rather_than_zero(self, cfg):
        empty = composite_score({"ml_probability": None, "docking": None,
                                 "drug_likeness": None, "clinical_history": None}, cfg)
        assert empty["score"] is None
        assert empty["formula"] == "no evidence available"

    def test_formula_is_exposed_for_inspection(self, cfg):
        result = composite_score({"ml_probability": 0.5, "docking": 0.5,
                                  "drug_likeness": None, "clinical_history": None}, cfg)
        assert "ml_probability" in result["formula"]
        assert "docking" in result["formula"]

    def test_candidate_language_never_overclaims(self):
        text = " ".join(CANDIDATE_LANGUAGE.values()).lower()
        for banned in ("best drug", "winner", "cure", "confirmed treatment", "proven"):
            assert banned not in text
        assert "candidate" in text


class TestRankingQuery:
    def _seed(self, db, cfg):
        pathogen = cfg.pathogens[0].key
        registry.register_model(
            db, model_version="RF-test-v1", pathogen_key=pathogen, model_type="random_forest",
            is_baseline=True, dataset_version="DS-test", feature_version="morgan-r2-1024-v1",
            validation_method="test", split_method="scaffold", random_seed=42,
            n_train=10, n_validation=2, n_test=3, metrics={"pr_auc": 0.8},
            cv_metrics=None, selection_reason="test", artifact_path=None,
            status=registry.STATE_ACTIVE, library_versions={},
        )
        ids = []
        for name in ("aspirin", "trimethoprim", "ciprofloxacin"):
            mid = insert_molecule(db, cfg, SMILES[name], pref_name=name)
            db.execute(
                """INSERT INTO drugs(drug_id, molecule_id, generic_name, approval_source,
                       first_seen_at) VALUES(?,?,?,?,?)""",
                (f"D-{name}", mid, name, "FDA Orange Book", utcnow()),
            )
            ids.append(mid)

        for mid, prob in zip(ids, (0.95, 0.80, 0.40)):
            db.execute(
                """INSERT INTO predictions(molecule_id, pathogen_key, probability, model_version,
                       model_type, dataset_version, feature_version, predicted_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (mid, pathogen, prob, "RF-test-v1", "random_forest", "DS-test",
                 "morgan-r2-1024-v1", utcnow()),
            )
        db.commit()
        return pathogen, ids

    def test_only_candidates_above_the_threshold_are_returned(self, db, cfg):
        pathogen, _ = self._seed(db, cfg)
        df = rank_candidates(db, cfg, pathogen, min_probability=0.6)
        assert len(df) == 2
        assert df["ml_probability"].min() >= 0.6

    def test_results_are_ranked_and_numbered(self, db, cfg):
        pathogen, _ = self._seed(db, cfg)
        df = rank_candidates(db, cfg, pathogen, min_probability=0.0)
        assert df["rank"].tolist() == [1, 2, 3]
        assert df["composite_score"].is_monotonic_decreasing

    def test_predictions_from_a_non_active_model_are_excluded(self, db, cfg):
        """Ranking must reflect the model currently in service, not an old one."""
        pathogen, ids = self._seed(db, cfg)
        db.execute(
            """INSERT INTO predictions(molecule_id, pathogen_key, probability, model_version,
                   model_type, dataset_version, feature_version, predicted_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (ids[0], pathogen, 0.99, "RF-old-v0", "random_forest", "DS-old",
             "morgan-r2-1024-v1", utcnow()),
        )
        db.commit()
        df = rank_candidates(db, cfg, pathogen, min_probability=0.0)
        assert set(df["model_version"]) == {"RF-test-v1"}

    def test_empty_result_returns_a_typed_empty_frame(self, db, cfg):
        df = rank_candidates(db, cfg, cfg.pathogens[0].key, min_probability=0.99)
        assert df.empty
        assert "composite_score" in df.columns


class TestDatabase:
    def test_pathogens_are_seeded_from_configuration(self, db, cfg):
        rows = db.execute("SELECT key FROM pathogens ORDER BY key").fetchall()
        assert {r["key"] for r in rows} == {p.key for p in cfg.pathogens}

    def test_schema_creation_is_idempotent(self, db, cfg):
        from src.db import init_db

        init_db(db, cfg)  # second call must not raise or duplicate rows
        assert table_count(db, "pathogens") == len(cfg.pathogens)

    def test_settings_round_trip(self, db):
        set_setting(db, "active_dataset_version", "DS-1")
        assert get_setting(db, "active_dataset_version") == "DS-1"
        assert get_setting(db, "missing", "fallback") == "fallback"

    def test_source_records_carry_provenance(self, db):
        record_source(db, "ChEMBL", "https://example.org", 100, source_version="v34")
        row = db.execute("SELECT * FROM data_sources").fetchone()
        assert row["name"] == "ChEMBL"
        assert row["source_version"] == "v34"
        assert row["retrieved_at"]

    def test_duplicate_activities_from_one_source_are_rejected(self, db, cfg):
        mid = insert_molecule(db, cfg, SMILES["aspirin"])
        for _ in range(2):
            db.execute(
                """INSERT INTO bioactivity(source_activity_id, source, molecule_id, pathogen_key,
                       created_at) VALUES(?,?,?,?,?)
                   ON CONFLICT(source, source_activity_id) DO NOTHING""",
                ("A1", "ChEMBL", mid, cfg.pathogens[0].key, utcnow()),
            )
        db.commit()
        assert table_count(db, "bioactivity") == 1

    def test_one_prediction_per_molecule_pathogen_model(self, db, cfg):
        mid = insert_molecule(db, cfg, SMILES["aspirin"])
        for probability in (0.5, 0.9):
            db.execute(
                """INSERT INTO predictions(molecule_id, pathogen_key, probability, model_version,
                       predicted_at) VALUES(?,?,?,?,?)
                   ON CONFLICT(molecule_id, pathogen_key, model_version)
                   DO UPDATE SET probability = excluded.probability""",
                (mid, cfg.pathogens[0].key, probability, "RF-v1", utcnow()),
            )
        db.commit()
        rows = db.execute("SELECT probability FROM predictions").fetchall()
        assert len(rows) == 1
        assert rows[0]["probability"] == 0.9

    def test_foreign_keys_are_enforced(self, db, cfg):
        import sqlite3

        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                """INSERT INTO predictions(molecule_id, pathogen_key, probability,
                       model_version, predicted_at) VALUES(?,?,?,?,?)""",
                ("NO-SUCH-MOLECULE", cfg.pathogens[0].key, 0.5, "RF-v1", utcnow()),
            )
            db.commit()


class TestMissingEvidenceRendering:
    """Absent evidence must read as absent - never as zero, never as "None".

    Streamlit prints both NaN and pd.NA as the literal text "None", which reads
    like a value. A docking score that does not exist must not look like a bad
    docking score. The placeholder is a typographic em dash, as the UI spec
    requires.
    """

    DASH = "—"

    def test_dash_na_replaces_missing_values(self):
        import pandas as pd

        from app.components import dash_na

        df = pd.DataFrame({
            "Score": [-8.2, None, float("nan")],
            "Phase": ["PHASE3", None, "PHASE1"],
            "Untouched": [1, None, 3],
        })
        out = dash_na(df, ["Score", "Phase"])

        assert list(out["Score"]) == [-8.2, self.DASH, self.DASH]
        assert list(out["Phase"]) == ["PHASE3", self.DASH, "PHASE1"]
        # Columns not named are left alone, so the helper never hides data silently.
        assert pd.isna(out["Untouched"].iloc[1])

    def test_dash_na_never_substitutes_zero(self):
        import pandas as pd

        from app.components import dash_na

        out = dash_na(pd.DataFrame({"Score": [0.0, None]}), ["Score"])
        assert out["Score"].iloc[0] == 0.0, "a real zero must survive"
        assert out["Score"].iloc[1] == self.DASH, "a missing value must not become zero"

    def test_dash_na_tolerates_absent_columns(self):
        import pandas as pd

        from app.components import dash_na

        df = pd.DataFrame({"A": [1]})
        assert list(dash_na(df, ["A", "NotThere"])["A"]) == [1]


class TestDataTableGuards:
    """The shared table must not take a page down, and must not invent values."""

    def test_height_none_is_not_passed_through(self, monkeypatch):
        """Streamlit rejects height=None; the helper must omit it instead."""
        import pandas as pd

        from app.components import layout

        captured: dict = {}

        def fake_dataframe(df, **kwargs):
            captured.update(kwargs)
            if kwargs.get("height", "absent") is None:
                raise ValueError("Invalid height value: None")

        monkeypatch.setattr(layout.st, "dataframe", fake_dataframe)
        monkeypatch.setattr(layout.st, "caption", lambda *a, **k: None)

        layout.data_table(pd.DataFrame({"A": [1, 2]}))
        assert "height" not in captured

    def test_explicit_height_is_forwarded(self, monkeypatch):
        import pandas as pd

        from app.components import layout

        captured: dict = {}
        monkeypatch.setattr(layout.st, "dataframe",
                            lambda df, **kw: captured.update(kw))
        monkeypatch.setattr(layout.st, "caption", lambda *a, **k: None)

        layout.data_table(pd.DataFrame({"A": [1]}), height=240)
        assert captured["height"] == 240

    def test_render_failure_shows_a_message_not_a_traceback(self, monkeypatch):
        import pandas as pd

        from app.components import layout

        shown: list[str] = []

        def boom(df, **kwargs):
            raise RuntimeError("arrow conversion exploded")

        monkeypatch.setattr(layout.st, "dataframe", boom)
        monkeypatch.setattr(layout.st, "error", lambda msg: shown.append(msg))
        monkeypatch.setattr(layout.st, "caption", lambda *a, **k: None)

        layout.data_table(pd.DataFrame({"A": [1]}))

        assert shown, "a readable message must be shown"
        assert "RuntimeError" in shown[0]
        assert "Traceback" not in shown[0]

    def test_empty_frame_is_handled(self, monkeypatch):
        import pandas as pd

        from app.components import layout

        captions: list[str] = []
        monkeypatch.setattr(layout.st, "caption", lambda msg: captions.append(msg))
        monkeypatch.setattr(layout.st, "dataframe",
                            lambda *a, **k: pytest.fail("should not render an empty frame"))

        layout.data_table(pd.DataFrame())
        assert captions
