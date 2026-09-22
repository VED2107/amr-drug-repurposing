"""Activity labelling strategy.

This module turns a heterogeneous bioactivity measurement into a single
comparable potency (pActivity) and, from it, a binary label. It is the most
scientifically consequential code in the project, so every decision it makes is
recorded on the record itself via ``pactivity_method`` and ``label_reason``.

Definitions
-----------
pActivity = -log10(molar potency). A pActivity of 5.0 is 10 uM, 6.0 is 1 uM.
Higher is more potent. This is the same convention as ChEMBL's pchembl_value.

Rules
-----
1. If ChEMBL supplies ``pchembl_value``, use it. It is the curated conversion
   and is preferred over recomputing from the raw value.
2. Otherwise convert the standard value to molar:
   - nM, uM, M convert directly.
   - ug/mL (and the equivalent mg/L) need the molecular weight, taken from the
     RDKit-parsed structure. Without a parseable structure the record is
     unusable and is dropped rather than guessed.
3. Censored relations are honoured. A ">" measurement means no effect was seen
   up to that dose, so it can only support an INACTIVE call; a "<" measurement
   can only support an ACTIVE call. Using a ">" record as evidence of activity
   would be reading the inequality backwards.
4. Values between the active and inactive thresholds are ambiguous. They are
   stored with ``label = NULL`` and excluded from training.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Multiplier converting a unit to molar, where that is possible without a
# molecular weight.
_MOLAR_FACTORS = {
    "m": 1.0,
    "mm": 1e-3,
    "um": 1e-6,
    "nm": 1e-9,
    "pm": 1e-12,
}

# Mass-per-volume units, normalised to grams per litre.
_MASS_PER_VOLUME_G_PER_L = {
    "ug.ml-1": 1e-3,
    "ug ml-1": 1e-3,
    "ug/ml": 1e-3,
    "mg.l-1": 1e-3,
    "mg/l": 1e-3,
    "mg.ml-1": 1.0,
    "mg/ml": 1.0,
    "ng.ml-1": 1e-6,
    "ng/ml": 1e-6,
}

LABEL_ACTIVE = 1
LABEL_INACTIVE = 0


@dataclass(frozen=True)
class LabelResult:
    """Outcome of labelling one bioactivity measurement."""

    pactivity: float | None
    method: str
    label: int | None
    reason: str

    @property
    def usable(self) -> bool:
        return self.label is not None


def to_pactivity(
    standard_value: float | None,
    standard_units: str | None,
    *,
    pchembl_value: float | None = None,
    molecular_weight: float | None = None,
) -> tuple[float | None, str]:
    """Convert a measurement to pActivity. Returns (value, method-or-reason)."""
    if pchembl_value is not None:
        try:
            return float(pchembl_value), "pchembl_value"
        except (TypeError, ValueError):
            pass

    if standard_value is None:
        return None, "no standard_value"

    try:
        value = float(standard_value)
    except (TypeError, ValueError):
        return None, f"non-numeric standard_value: {standard_value!r}"

    if value <= 0:
        # Zero or negative potencies are data-entry artefacts; -log10 is
        # undefined and silently clipping them would invent a potency.
        return None, f"non-positive standard_value: {value}"

    units = (standard_units or "").strip().lower()
    if not units:
        return None, "missing units"

    if units in _MOLAR_FACTORS:
        molar = value * _MOLAR_FACTORS[units]
        return -math.log10(molar), f"converted from {standard_units}"

    if units in _MASS_PER_VOLUME_G_PER_L:
        if molecular_weight is None or molecular_weight <= 0:
            return None, f"{standard_units} needs a molecular weight to convert"
        grams_per_litre = value * _MASS_PER_VOLUME_G_PER_L[units]
        molar = grams_per_litre / molecular_weight
        if molar <= 0:
            return None, "conversion produced a non-positive molar value"
        return -math.log10(molar), f"converted from {standard_units} using MW={molecular_weight:.2f}"

    return None, f"unsupported units: {standard_units}"


def label_measurement(
    standard_value: float | None,
    standard_units: str | None,
    standard_relation: str | None,
    *,
    pchembl_value: float | None = None,
    molecular_weight: float | None = None,
    active_threshold: float = 5.0,
    inactive_threshold: float = 4.0,
    honour_censored: bool = True,
) -> LabelResult:
    """Assign an activity label to one measurement, or None when unusable."""
    pact, method = to_pactivity(
        standard_value,
        standard_units,
        pchembl_value=pchembl_value,
        molecular_weight=molecular_weight,
    )
    if pact is None:
        return LabelResult(None, method, None, f"not labellable: {method}")

    relation = (standard_relation or "=").strip()

    if honour_censored:
        if relation in {">", ">=", ">>"}:
            # "MIC > 64 ug/mL": no activity observed up to that dose.
            # A high pActivity is impossible to conclude; only an inactive call
            # is supportable, and only when the tested dose was weak enough.
            if pact <= inactive_threshold:
                return LabelResult(pact, method, LABEL_INACTIVE,
                                   f"censored '{relation}': no activity up to pActivity {pact:.2f}")
            return LabelResult(pact, method, None,
                               f"censored '{relation}' above the inactive threshold: uninformative")
        if relation in {"<", "<=", "<<"}:
            # "MIC < 1 ug/mL": activity at least this strong.
            if pact >= active_threshold:
                return LabelResult(pact, method, LABEL_ACTIVE,
                                   f"censored '{relation}': active at pActivity >= {pact:.2f}")
            return LabelResult(pact, method, None,
                               f"censored '{relation}' below the active threshold: uninformative")
        if relation == "~":
            # Approximate values are usable but flagged.
            method = f"{method} (approximate)"

    if pact >= active_threshold:
        return LabelResult(pact, method, LABEL_ACTIVE, f"pActivity {pact:.2f} >= {active_threshold}")
    if pact <= inactive_threshold:
        return LabelResult(pact, method, LABEL_INACTIVE, f"pActivity {pact:.2f} <= {inactive_threshold}")
    return LabelResult(pact, method, None,
                       f"ambiguous: pActivity {pact:.2f} lies between {inactive_threshold} and {active_threshold}")


def aggregate_labels(pactivities: list[float], labels: list[int], method: str = "median") -> tuple[float, int]:
    """Collapse repeat measurements of one compound/pathogen pair.

    The aggregated pActivity is the median (robust to a single outlying assay);
    the aggregated label is re-derived by majority vote, with ties resolved
    towards ACTIVE because a reproducible active reading in any assay is the
    more informative observation.
    """
    if not pactivities:
        raise ValueError("cannot aggregate an empty measurement list")

    values = sorted(pactivities)
    if method == "median":
        n = len(values)
        mid = n // 2
        agg = values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2.0
    elif method == "max":
        agg = values[-1]
    elif method == "mean":
        agg = sum(values) / len(values)
    else:
        raise ValueError(f"unknown aggregation method: {method}")

    n_active = sum(1 for v in labels if v == LABEL_ACTIVE)
    agg_label = LABEL_ACTIVE if n_active * 2 >= len(labels) else LABEL_INACTIVE
    return agg, agg_label
