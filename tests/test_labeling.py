"""Activity labelling - the most scientifically consequential logic here."""

from __future__ import annotations

import math

import pytest

from src.ml.labeling import LABEL_ACTIVE, LABEL_INACTIVE, aggregate_labels, label_measurement, to_pactivity


class TestUnitConversion:
    def test_nanomolar_converts_directly(self):
        value, method = to_pactivity(100.0, "nM")
        assert value == pytest.approx(7.0)
        assert "nM" in method

    def test_micromolar_converts_directly(self):
        value, _ = to_pactivity(10.0, "uM")
        assert value == pytest.approx(5.0)

    def test_molar_converts_directly(self):
        value, _ = to_pactivity(0.001, "M")
        assert value == pytest.approx(3.0)

    def test_pchembl_is_used_verbatim_when_present(self):
        """ChEMBL's curated value wins over recomputation."""
        value, method = to_pactivity(9999.0, "nM", pchembl_value=6.5)
        assert value == 6.5
        assert method == "pchembl_value"

    def test_mass_per_volume_needs_a_molecular_weight(self):
        value, reason = to_pactivity(1.0, "ug.mL-1")
        assert value is None
        assert "molecular weight" in reason

    def test_mass_per_volume_converts_with_a_molecular_weight(self):
        # 1 ug/mL of a 500 Da compound is 1e-3 g/L / 500 g/mol = 2e-6 M.
        value, method = to_pactivity(1.0, "ug.mL-1", molecular_weight=500.0)
        assert value == pytest.approx(-math.log10(2e-6), abs=1e-6)
        assert "MW=500" in method

    def test_mg_per_litre_equals_ug_per_ml(self):
        a, _ = to_pactivity(4.0, "ug.mL-1", molecular_weight=400.0)
        b, _ = to_pactivity(4.0, "mg.L-1", molecular_weight=400.0)
        assert a == pytest.approx(b)

    @pytest.mark.parametrize("value", [0.0, -1.0])
    def test_non_positive_values_are_refused(self, value):
        result, reason = to_pactivity(value, "nM")
        assert result is None
        assert "non-positive" in reason

    def test_unknown_units_are_refused_rather_than_guessed(self):
        value, reason = to_pactivity(1.0, "percent")
        assert value is None
        assert "unsupported units" in reason

    def test_missing_units_are_refused(self):
        value, reason = to_pactivity(1.0, None)
        assert value is None
        assert reason == "missing units"

    def test_non_numeric_value_is_refused(self):
        value, reason = to_pactivity("strong", "nM")
        assert value is None
        assert "non-numeric" in reason


class TestLabelAssignment:
    def test_potent_compound_is_active(self):
        result = label_measurement(100.0, "nM", "=")
        assert result.label == LABEL_ACTIVE
        assert result.usable

    def test_weak_compound_is_inactive(self):
        result = label_measurement(1000.0, "uM", "=")
        assert result.label == LABEL_INACTIVE

    def test_value_between_thresholds_is_ambiguous_and_unusable(self):
        # pActivity 4.5 sits between the inactive (4.0) and active (5.0) cuts.
        result = label_measurement(10 ** (-4.5) * 1e9, "nM", "=")
        assert result.label is None
        assert not result.usable
        assert "ambiguous" in result.reason

    def test_greater_than_relation_can_only_support_inactive(self):
        """'MIC > 128 ug/mL' means no effect was seen; it cannot mean active."""
        result = label_measurement(128.0, "ug.mL-1", ">", molecular_weight=300.0)
        assert result.label == LABEL_INACTIVE
        assert "censored" in result.reason

    def test_greater_than_at_a_potent_dose_is_uninformative(self):
        # "> 1 nM" excludes nothing useful: it is consistent with any potency
        # weaker than 1 nM, including strongly active.
        result = label_measurement(1.0, "nM", ">")
        assert result.label is None
        assert "uninformative" in result.reason

    def test_less_than_relation_can_only_support_active(self):
        result = label_measurement(1.0, "nM", "<")
        assert result.label == LABEL_ACTIVE
        assert "censored" in result.reason

    def test_less_than_at_a_weak_dose_is_uninformative(self):
        result = label_measurement(1000.0, "uM", "<")
        assert result.label is None
        assert "uninformative" in result.reason

    def test_censored_handling_can_be_disabled(self):
        result = label_measurement(1.0, "nM", ">", honour_censored=False)
        assert result.label == LABEL_ACTIVE  # treated as an equality

    def test_approximate_relation_is_flagged_but_usable(self):
        result = label_measurement(100.0, "nM", "~")
        assert result.label == LABEL_ACTIVE
        assert "approximate" in result.method

    def test_thresholds_are_configurable(self):
        # pActivity 7.0 is active under the defaults but ambiguous once the
        # active cut is raised to 8.0 with the inactive cut at 6.0.
        assert label_measurement(100.0, "nM", "=").label == LABEL_ACTIVE
        strict = label_measurement(100.0, "nM", "=", active_threshold=8.0, inactive_threshold=6.0)
        assert strict.label is None
        assert "ambiguous" in strict.reason

    def test_unlabellable_measurement_reports_why(self):
        result = label_measurement(None, "nM", "=")
        assert result.label is None
        assert "not labellable" in result.reason


class TestAggregation:
    def test_median_is_robust_to_one_outlier(self):
        pact, label = aggregate_labels([6.0, 6.1, 9.9], [1, 1, 1], "median")
        assert pact == pytest.approx(6.1)
        assert label == LABEL_ACTIVE

    def test_even_count_takes_the_midpoint(self):
        pact, _ = aggregate_labels([4.0, 6.0], [0, 1], "median")
        assert pact == pytest.approx(5.0)

    def test_majority_vote_decides_the_label(self):
        _, label = aggregate_labels([6.0, 6.0, 3.0], [1, 1, 0], "median")
        assert label == LABEL_ACTIVE
        _, label = aggregate_labels([3.0, 3.0, 6.0], [0, 0, 1], "median")
        assert label == LABEL_INACTIVE

    def test_tie_resolves_towards_active(self):
        _, label = aggregate_labels([6.0, 3.0], [1, 0], "median")
        assert label == LABEL_ACTIVE

    def test_max_and_mean_are_supported(self):
        assert aggregate_labels([4.0, 6.0], [0, 1], "max")[0] == 6.0
        assert aggregate_labels([4.0, 6.0], [0, 1], "mean")[0] == pytest.approx(5.0)

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError):
            aggregate_labels([1.0], [1], "geometric")

    def test_empty_input_raises(self):
        with pytest.raises(ValueError):
            aggregate_labels([], [])
