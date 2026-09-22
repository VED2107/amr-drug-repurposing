"""Splits, model zoo, evaluation, registry promotion and prediction."""

from __future__ import annotations

import json

import numpy as np
import pytest

from src.ml import models as zoo
from src.ml import registry
from src.ml.evaluate import calibration_bins, curve_points, evaluate_predictions
from src.ml.splits import check_leakage, make_split, random_split, scaffold_split


class TestSplits:
    def test_scaffold_groups_never_straddle_the_split(self):
        """The whole point of a scaffold split: no analogue leaks across."""
        scaffolds = [f"S{i // 5}" for i in range(100)]
        labels = [i % 2 for i in range(100)]
        split = make_split(
            method="scaffold", scaffolds=scaffolds, labels=labels,
            test_fraction=0.2, validation_fraction=0.15, seed=42,
        )
        partition_of: dict[str, set[str]] = {}
        for name, indices in (
            ("train", split.train_idx), ("val", split.val_idx), ("test", split.test_idx)
        ):
            for i in indices:
                partition_of.setdefault(scaffolds[int(i)], set()).add(name)
        straddling = {s: p for s, p in partition_of.items() if len(p) > 1}
        assert not straddling, f"scaffolds present in several partitions: {straddling}"

    def test_every_row_is_assigned_exactly_once(self):
        scaffolds = [f"S{i // 3}" for i in range(60)]
        split = make_split(
            method="scaffold", scaffolds=scaffolds, labels=[i % 2 for i in range(60)],
            test_fraction=0.2, validation_fraction=0.15, seed=7,
        )
        combined = np.concatenate([split.train_idx, split.val_idx, split.test_idx])
        assert sorted(combined.tolist()) == list(range(60))

    def test_split_is_reproducible_from_the_seed(self):
        scaffolds = [f"S{i // 4}" for i in range(80)]
        labels = [i % 2 for i in range(80)]
        kwargs = dict(scaffolds=scaffolds, labels=labels, test_fraction=0.2,
                      validation_fraction=0.15, seed=11)
        a = make_split(method="scaffold", **kwargs)
        b = make_split(method="scaffold", **kwargs)
        assert np.array_equal(a.test_idx, b.test_idx)

    def test_both_classes_reach_the_test_partition(self):
        # Heavily skewed towards class 0, with the actives concentrated in a
        # few scaffolds - the arrangement that produces a single-class test set
        # unless the split actively corrects for it.
        scaffolds = [f"S{i // 6}" for i in range(120)]
        labels = [1 if i < 12 else 0 for i in range(120)]
        split = scaffold_split(
            scaffolds, test_fraction=0.2, validation_fraction=0.15, seed=3, labels=labels
        )
        test_labels = {labels[int(i)] for i in split.test_idx}
        assert len(test_labels) == 2, "test partition collapsed to a single class"

    def test_random_split_respects_the_requested_proportions(self):
        split = random_split(100, test_fraction=0.2, validation_fraction=0.1, seed=1)
        assert split.sizes() == {"train": 70, "validation": 10, "test": 20}

    def test_empty_dataset_produces_empty_partitions(self):
        split = scaffold_split([], test_fraction=0.2, validation_fraction=0.15, seed=1)
        assert split.sizes() == {"train": 0, "validation": 0, "test": 0}

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError):
            make_split(method="kmeans", scaffolds=["a"], labels=[1],
                       test_fraction=0.2, validation_fraction=0.1, seed=1)

    def test_leakage_check_detects_shared_molecules(self):
        result = check_leakage(["A", "B", "C"], ["C", "D"])
        assert not result["clean"]
        assert result["n_overlap"] == 1
        assert check_leakage(["A", "B"], ["C"])["clean"]


class TestEvaluation:
    def test_perfect_ranking_scores_one(self):
        y = np.array([0, 0, 1, 1])
        p = np.array([0.1, 0.2, 0.8, 0.9])
        m = evaluate_predictions(y, p)
        assert m["roc_auc"] == pytest.approx(1.0)
        assert m["pr_auc"] == pytest.approx(1.0)
        assert m["accuracy"] == pytest.approx(1.0)

    def test_inverted_ranking_scores_zero(self):
        m = evaluate_predictions(np.array([0, 0, 1, 1]), np.array([0.9, 0.8, 0.2, 0.1]))
        assert m["roc_auc"] == pytest.approx(0.0)

    def test_confusion_matrix_entries_are_correct(self):
        y = np.array([1, 1, 0, 0])
        p = np.array([0.9, 0.1, 0.8, 0.2])
        cm = evaluate_predictions(y, p)["confusion_matrix"]
        assert cm == {"tn": 1, "fp": 1, "fn": 1, "tp": 1}

    def test_single_class_evaluation_reports_none_not_a_number(self):
        """A fabricated metric would be worse than an honest None."""
        m = evaluate_predictions(np.array([1, 1, 1]), np.array([0.9, 0.8, 0.7]))
        assert m["roc_auc"] is None
        assert m["pr_auc"] is None
        assert m["single_class_evaluation_set"] is True
        assert "warning" in m

    def test_empty_evaluation_set_is_reported(self):
        m = evaluate_predictions(np.array([]), np.array([]))
        assert m["n"] == 0
        assert "error" in m

    def test_prevalence_is_recorded_so_pr_auc_can_be_judged(self):
        m = evaluate_predictions(np.array([1, 1, 1, 0]), np.array([0.9, 0.8, 0.7, 0.1]))
        assert m["positive_prevalence"] == pytest.approx(0.75)
        assert m["pr_auc_baseline"] == pytest.approx(0.75)

    def test_normalised_pr_auc_removes_the_prevalence_floor(self):
        """Raw PR-AUC is bounded below by prevalence; the normalised form is not."""
        # 95% positives: a near-random ranker still scores ~0.95 raw.
        y = np.array([1] * 19 + [0])
        p = np.concatenate([np.linspace(0.4, 0.6, 19), [0.5]])
        m = evaluate_predictions(y, p)
        assert m["pr_auc"] > 0.9, "raw PR-AUC is inflated by prevalence, as expected"
        assert m["pr_auc_normalized"] < 0.6, "normalised PR-AUC should expose the weak ranking"

    def test_normalised_pr_auc_is_one_for_a_perfect_ranker(self):
        m = evaluate_predictions(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9]))
        assert m["pr_auc_normalized"] == pytest.approx(1.0)

    def test_sensitivity_and_specificity(self):
        y = np.array([1, 1, 0, 0, 0])
        p = np.array([0.9, 0.9, 0.1, 0.1, 0.9])
        m = evaluate_predictions(y, p)
        assert m["sensitivity"] == pytest.approx(1.0)
        assert m["specificity"] == pytest.approx(2 / 3)

    def test_curve_points_are_produced_for_two_class_data(self):
        curves = curve_points(np.array([0, 1, 0, 1]), np.array([0.1, 0.9, 0.2, 0.8]))
        assert curves["roc"] and curves["pr"]
        assert len(curves["roc"]["fpr"]) == len(curves["roc"]["tpr"])

    def test_curve_points_absent_for_single_class(self):
        assert curve_points(np.array([1, 1]), np.array([0.5, 0.6]))["roc"] is None

    def test_calibration_bins_summarise_reliability(self):
        y = np.array([0, 0, 1, 1, 1, 0])
        p = np.array([0.05, 0.15, 0.85, 0.95, 0.75, 0.25])
        bins = calibration_bins(y, p, n_bins=5)
        assert bins
        assert all(0.0 <= b["observed_frequency"] <= 1.0 for b in bins)


class TestModelZoo:
    def test_baseline_is_always_included_even_if_not_requested(self):
        specs, _ = zoo.resolve_specs(["logistic_regression"], n_rows=500, min_rows_for_boosting=800)
        assert any(s.key == zoo.BASELINE_MODEL for s in specs)

    def test_boosting_is_skipped_on_small_data_with_a_stated_reason(self):
        specs, skipped = zoo.resolve_specs(
            ["random_forest", "hist_gradient_boosting"], n_rows=100, min_rows_for_boosting=800
        )
        assert "hist_gradient_boosting" not in {s.key for s in specs}
        reason = next(s["reason"] for s in skipped if s["model"] == "hist_gradient_boosting")
        assert "below" in reason

    def test_boosting_is_offered_on_large_data(self):
        specs, _ = zoo.resolve_specs(
            ["random_forest", "hist_gradient_boosting"], n_rows=5000, min_rows_for_boosting=800
        )
        assert "hist_gradient_boosting" in {s.key for s in specs}

    def test_unknown_model_is_skipped_not_fatal(self):
        specs, skipped = zoo.resolve_specs(["nonexistent"], n_rows=1000, min_rows_for_boosting=800)
        assert any(s["reason"] == "unknown model key" for s in skipped)
        assert specs  # the baseline still comes back

    @pytest.mark.parametrize(
        "key", ["random_forest", "extra_trees", "logistic_regression", "linear_svm"]
    )
    def test_every_model_exposes_a_probability(self, key):
        rng = np.random.default_rng(0)
        X = rng.integers(0, 2, size=(80, 32)).astype(np.float32)
        y = (X[:, 0] + X[:, 1] > 0).astype(int)
        model = zoo.build(key, {}, seed=0, class_weight="balanced")
        model.fit(X, y)
        probabilities = zoo.predict_proba(model, X)
        assert probabilities.shape == (80,)
        assert np.all((probabilities >= 0) & (probabilities <= 1))

    def test_tree_models_expose_feature_importance(self):
        rng = np.random.default_rng(1)
        X = rng.integers(0, 2, size=(60, 16)).astype(np.float32)
        y = X[:, 3].astype(int)
        model = zoo.build("random_forest", {"n_estimators": 20}, seed=0, class_weight=None)
        model.fit(X, y)
        importance = zoo.feature_importance(model, 16)
        assert importance is not None and importance.shape == (16,)
        assert int(np.argmax(importance)) == 3

    def test_build_rejects_an_unknown_key(self):
        with pytest.raises(ValueError):
            zoo.build("does_not_exist", {}, seed=0, class_weight=None)


def _register(db, version, pathogen, metrics, status=registry.STATE_CANDIDATE, model_type="random_forest"):
    registry.register_model(
        db, model_version=version, pathogen_key=pathogen, model_type=model_type,
        is_baseline=model_type == "random_forest", dataset_version="DS-test",
        feature_version="morgan-r2-1024-v1", validation_method="test", split_method="scaffold",
        random_seed=42, n_train=100, n_validation=20, n_test=30, metrics=metrics,
        cv_metrics=None, selection_reason="test", artifact_path=None, status=status,
        library_versions={},
    )
    db.commit()


class TestRegistryPromotion:
    GOOD = {"pr_auc": 0.80, "roc_auc": 0.88, "f1": 0.7}
    BETTER = {"pr_auc": 0.90, "roc_auc": 0.93, "f1": 0.8}
    MARGINAL = {"pr_auc": 0.805, "roc_auc": 0.881, "f1": 0.71}
    WORSE = {"pr_auc": 0.55, "roc_auc": 0.70, "f1": 0.5}
    BELOW_FLOOR = {"pr_auc": 0.10, "roc_auc": 0.52, "f1": 0.1}

    def test_first_acceptable_model_is_promoted(self, db, cfg):
        decision = registry.evaluate_promotion(cfg, self.GOOD, None)
        assert decision.promote
        assert "no active model" in decision.reason

    def test_better_model_replaces_the_incumbent(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD, registry.STATE_ACTIVE)
        incumbent = registry.get_active_model(db, "mrsa")
        decision = registry.evaluate_promotion(cfg, self.BETTER, incumbent)
        assert decision.promote

    def test_worse_model_never_replaces_a_good_one(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD, registry.STATE_ACTIVE)
        incumbent = registry.get_active_model(db, "mrsa")
        decision = registry.evaluate_promotion(cfg, self.WORSE, incumbent)
        assert not decision.promote
        assert "does not beat" in decision.reason

    def test_marginal_gain_inside_the_noise_margin_is_not_promoted(self):
        """Version churn from noise is exactly what the margin prevents."""
        from src.config import Config

        cfg = Config(
            {
                "project": {}, "paths": {"database": "x"}, "ingestion": {}, "pathogens": [],
                "labeling": {"active_threshold_pactivity": 5.0, "inactive_threshold_pactivity": 4.0},
                "chemistry": {"fingerprint": {"n_bits": 1024}},
                "ml": {"selection": {"primary_metric": "pr_auc", "promotion_margin": 0.01,
                                     "min_acceptable_pr_auc": 0.3, "min_acceptable_roc_auc": 0.6}},
                "screening": {}, "docking": {},
            },
            __import__("pathlib").Path("memory.yaml"),
        )

        class FakeRow(dict):
            def __getitem__(self, key):
                return dict.__getitem__(self, key)

        incumbent = FakeRow(model_version="RF-v1", metrics_json=json.dumps(self.GOOD))
        decision = registry.evaluate_promotion(cfg, self.MARGINAL, incumbent)
        assert not decision.promote

    def test_model_below_the_absolute_floor_is_never_promoted(self, db, cfg):
        decision = registry.evaluate_promotion(cfg, self.BELOW_FLOOR, None)
        assert not decision.promote
        assert "floor" in decision.reason

    def test_promotion_archives_the_previous_active_model(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD, registry.STATE_ACTIVE)
        _register(db, "ET-mrsa-v1", "mrsa", self.BETTER, registry.STATE_CANDIDATE, "extra_trees")
        registry.promote(db, "ET-mrsa-v1", "mrsa", "better PR-AUC")

        active = registry.get_active_model(db, "mrsa")
        assert active["model_version"] == "ET-mrsa-v1"
        old = db.execute(
            "SELECT status FROM model_versions WHERE model_version = 'RF-mrsa-v1'"
        ).fetchone()
        assert old["status"] == registry.STATE_ARCHIVED

    def test_only_one_model_is_active_per_pathogen(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD, registry.STATE_ACTIVE)
        _register(db, "ET-mrsa-v1", "mrsa", self.BETTER, registry.STATE_CANDIDATE, "extra_trees")
        registry.promote(db, "ET-mrsa-v1", "mrsa", "better")
        n = db.execute(
            "SELECT COUNT(*) FROM model_versions WHERE pathogen_key='mrsa' AND status='ACTIVE'"
        ).fetchone()[0]
        assert n == 1

    def test_baseline_remains_findable_after_being_superseded(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD, registry.STATE_ACTIVE)
        _register(db, "ET-mrsa-v1", "mrsa", self.BETTER, registry.STATE_CANDIDATE, "extra_trees")
        registry.promote(db, "ET-mrsa-v1", "mrsa", "better")
        baseline = registry.get_baseline_model(db, "mrsa")
        assert baseline["model_version"] == "RF-mrsa-v1"
        assert baseline["model_type"] == "random_forest"

    def test_version_numbers_increment_per_model_type_and_pathogen(self, db, cfg):
        assert registry.next_model_version(db, "random_forest", "mrsa") == "RF-mrsa-v1"
        _register(db, "RF-mrsa-v1", "mrsa", self.GOOD)
        assert registry.next_model_version(db, "random_forest", "mrsa") == "RF-mrsa-v2"
        assert registry.next_model_version(db, "random_forest", "ecoli") == "RF-ecoli-v1"

    def test_prevalence_adjusted_metric_is_used_for_comparison(self, db, cfg):
        """The real failure this prevents: an easy test set keeping a bad model active.

        The incumbent scored 0.994 raw PR-AUC on a 98.5%-positive test set,
        which is barely better than random. The challenger scored 0.994 on a
        75%-positive set, which is genuinely strong. Comparing raw values would
        keep the weak incumbent.
        """
        weak_incumbent = {"pr_auc": 0.9944, "positive_prevalence": 0.985,
                          "pr_auc_normalized": (0.9944 - 0.985) / 0.015, "roc_auc": 0.67}
        strong_challenger = {"pr_auc": 0.9938, "positive_prevalence": 0.751,
                             "pr_auc_normalized": (0.9938 - 0.751) / 0.249, "roc_auc": 0.98}

        _register(db, "ET-kp-v1", "kpneumoniae", weak_incumbent, registry.STATE_ACTIVE, "extra_trees")
        incumbent = registry.get_active_model(db, "kpneumoniae")

        decision = registry.evaluate_promotion(cfg, strong_challenger, incumbent)
        assert decision.promote, decision.reason
        assert "prevalence-adjusted" in decision.reason

    def test_a_model_that_only_matches_prevalence_fails_the_floor(self, db, cfg):
        near_random = {"pr_auc": 0.98, "positive_prevalence": 0.975,
                       "pr_auc_normalized": (0.98 - 0.975) / 0.025, "roc_auc": 0.52}
        decision = registry.evaluate_promotion(cfg, near_random, None)
        assert not decision.promote
        assert "floor" in decision.reason

    def test_comparison_metric_falls_back_to_the_raw_value(self):
        value, name = registry.comparison_metric({"pr_auc": 0.7}, "pr_auc")
        assert value == 0.7 and name == "pr_auc"

    def test_adjusted_metric_is_derived_for_older_records(self):
        """Both sides of a comparison must be on the same scale, always."""
        value, name = registry.comparison_metric(
            {"pr_auc": 0.9944, "positive_prevalence": 0.985}, "pr_auc"
        )
        assert name == "prevalence-adjusted PR-AUC"
        assert value == pytest.approx((0.9944 - 0.985) / 0.015)

    def test_rejected_model_is_marked_with_its_reason(self, db, cfg):
        _register(db, "RF-mrsa-v1", "mrsa", self.BELOW_FLOOR)
        registry.reject(db, "RF-mrsa-v1", "below the PR-AUC floor")
        row = db.execute(
            "SELECT status, selection_reason FROM model_versions WHERE model_version='RF-mrsa-v1'"
        ).fetchone()
        assert row["status"] == registry.STATE_REJECTED
        assert "floor" in row["selection_reason"]


class TestMetricBackfill:
    """Older model records must still be comparable on the adjusted scale."""

    def test_adjusted_value_is_derived_when_absent(self):
        from src.ml.evaluate import ensure_normalized

        out = ensure_normalized({"pr_auc": 0.9944, "positive_prevalence": 0.985})
        assert out["pr_auc_normalized"] == pytest.approx((0.9944 - 0.985) / 0.015)
        assert out["pr_auc_baseline"] == pytest.approx(0.985)

    def test_existing_value_is_left_alone(self):
        from src.ml.evaluate import ensure_normalized

        out = ensure_normalized(
            {"pr_auc": 0.9, "positive_prevalence": 0.5, "pr_auc_normalized": 0.42}
        )
        assert out["pr_auc_normalized"] == 0.42

    def test_underivable_metrics_stay_untouched(self):
        from src.ml.evaluate import ensure_normalized

        # Without a prevalence the adjusted value cannot be derived, so the key
        # stays absent rather than being filled with a guess.
        assert ensure_normalized({"pr_auc": 0.9}).get("pr_auc_normalized") is None
        assert ensure_normalized({}) == {}
        assert ensure_normalized(None) == {}

    def test_degenerate_prevalence_is_not_divided_by_zero(self):
        from src.ml.evaluate import ensure_normalized

        out = ensure_normalized({"pr_auc": 1.0, "positive_prevalence": 1.0})
        assert out.get("pr_auc_normalized") is None


class TestCurveStorage:
    """Curves are stored at training time so the dashboard never recomputes them."""

    def test_downsampling_keeps_the_endpoints_and_the_cap(self):
        from src.ml.evaluate import downsample_curve

        curve = {"fpr": [i / 999 for i in range(1000)], "tpr": [i / 999 for i in range(1000)]}
        thinned = downsample_curve(curve, max_points=50)
        assert len(thinned["fpr"]) <= 51
        assert thinned["fpr"][0] == curve["fpr"][0]
        assert thinned["fpr"][-1] == curve["fpr"][-1]
        assert len(thinned["fpr"]) == len(thinned["tpr"])

    def test_short_curves_are_returned_unchanged(self):
        from src.ml.evaluate import downsample_curve

        curve = {"fpr": [0.0, 0.5, 1.0], "tpr": [0.0, 0.8, 1.0]}
        assert downsample_curve(curve, max_points=200) == curve

    def test_empty_curve_is_none(self):
        from src.ml.evaluate import downsample_curve

        assert downsample_curve(None) is None
        assert downsample_curve({}) is None

    def test_curves_are_persisted_with_the_model(self, db, cfg):
        curves = {"test": {"roc": {"fpr": [0.0, 1.0], "tpr": [0.0, 1.0]}, "pr": None}}
        registry.register_model(
            db, model_version="RF-curve-v1", pathogen_key="mrsa", model_type="random_forest",
            is_baseline=True, dataset_version="DS-test", feature_version="f",
            validation_method="test", split_method="scaffold", random_seed=1,
            n_train=10, n_validation=2, n_test=3, metrics={"pr_auc": 0.8},
            cv_metrics=None, selection_reason="test", artifact_path=None,
            status=registry.STATE_ACTIVE, library_versions={}, curves=curves,
        )
        db.commit()
        stored = db.execute(
            "SELECT curves_json FROM model_versions WHERE model_version='RF-curve-v1'"
        ).fetchone()["curves_json"]
        assert json.loads(stored)["test"]["roc"]["fpr"] == [0.0, 1.0]

    def test_migration_adds_the_column_to_an_existing_database(self, tmp_path, cfg):
        """A database created before curve storage must gain the column, not break."""
        import sqlite3

        from src.db import init_db

        path = tmp_path / "old.sqlite"
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        # A model_versions table as it existed before the column was introduced.
        conn.execute(
            """CREATE TABLE model_versions (
                   model_version TEXT PRIMARY KEY, pathogen_key TEXT, model_type TEXT,
                   is_baseline INTEGER, dataset_version TEXT, feature_version TEXT,
                   training_date TEXT, validation_method TEXT, split_method TEXT,
                   random_seed INTEGER, n_train INTEGER, n_validation INTEGER,
                   n_test INTEGER, metrics_json TEXT, cv_metrics_json TEXT,
                   selection_reason TEXT, artifact_path TEXT, status TEXT,
                   library_versions TEXT, created_at TEXT)"""
        )
        conn.commit()

        init_db(conn, cfg)

        columns = {row["name"] for row in conn.execute("PRAGMA table_info(model_versions)")}
        assert "curves_json" in columns
        conn.close()
