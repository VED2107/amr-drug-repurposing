"""Scientific sanity checks.

These run over a trained model's stored evaluation and the dataset behind it,
looking for the failure modes that make a cheminformatics result look good
without being good: leakage, degenerate evaluation sets, a metric that merely
reproduces the class prevalence, and units or organisms that do not belong.

The checks produce findings, not fixes. Silently "correcting" data to make a
model look better is the exact behaviour they exist to catch.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Any

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"


@dataclass
class Finding:
    check: str
    severity: str
    message: str
    detail: dict[str, Any] = field(default_factory=dict)


def _load_metrics(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {}
    try:
        return json.loads(row["metrics_json"] or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def check_model(conn: sqlite3.Connection, model_version: str) -> list[Finding]:
    """Sanity-check one model version against its stored evaluation."""
    row = conn.execute(
        "SELECT * FROM model_versions WHERE model_version = ?", (model_version,)
    ).fetchone()
    if row is None:
        return [Finding("model_exists", SEVERITY_CRITICAL, f"no such model version: {model_version}")]

    metrics = _load_metrics(row)
    findings: list[Finding] = []

    prevalence = metrics.get("positive_prevalence")
    pr_auc = metrics.get("pr_auc")
    roc_auc = metrics.get("roc_auc")
    n_test = metrics.get("n")

    # A PR-AUC close to the class prevalence is what a random ranker achieves.
    # A high PR-AUC on a set that is mostly positives means almost nothing.
    if pr_auc is not None and prevalence is not None:
        lift = pr_auc - prevalence
        if prevalence >= 0.85:
            findings.append(
                Finding(
                    "prevalence_dominated_evaluation", SEVERITY_CRITICAL,
                    f"the test set is {prevalence:.0%} positive, so PR-AUC {pr_auc:.3f} is close to "
                    "what a random ranker scores. This metric should not be read as good performance.",
                    {"prevalence": prevalence, "pr_auc": pr_auc, "lift_over_prevalence": lift},
                )
            )
        elif lift < 0.05:
            findings.append(
                Finding(
                    "pr_auc_no_lift", SEVERITY_WARNING,
                    f"PR-AUC {pr_auc:.3f} barely exceeds the class prevalence {prevalence:.3f}; "
                    "the model adds little ranking information.",
                    {"prevalence": prevalence, "pr_auc": pr_auc, "lift_over_prevalence": lift},
                )
            )

    if roc_auc is not None and roc_auc < 0.5:
        findings.append(
            Finding(
                "roc_below_chance", SEVERITY_CRITICAL,
                f"ROC-AUC {roc_auc:.3f} is below chance. The model ranks actives worse than random; "
                "investigate label polarity and the split before using it.",
                {"roc_auc": roc_auc},
            )
        )

    if roc_auc is not None and roc_auc > 0.98:
        findings.append(
            Finding(
                "suspiciously_high_performance", SEVERITY_WARNING,
                f"ROC-AUC {roc_auc:.3f} is unusually high for whole-cell antibacterial data. "
                "Check for duplicate structures across the split and for assay-level leakage.",
                {"roc_auc": roc_auc},
            )
        )

    if n_test is not None and int(n_test) < 30:
        findings.append(
            Finding(
                "small_test_set", SEVERITY_WARNING,
                f"the test set holds only {n_test} compounds; every metric carries wide uncertainty.",
                {"n_test": n_test},
            )
        )

    if metrics.get("single_class_evaluation_set"):
        findings.append(
            Finding(
                "single_class_test_set", SEVERITY_CRITICAL,
                "the test set contains a single class, so ranking metrics are undefined.",
            )
        )

    # Structural leakage between the partitions of the model's dataset version.
    overlap = conn.execute(
        """SELECT COUNT(*) FROM (
               SELECT a.molecule_id
               FROM dataset_members a
               JOIN dataset_members b
                 ON a.molecule_id = b.molecule_id
                AND a.dataset_version = b.dataset_version
                AND a.pathogen_key = b.pathogen_key
               WHERE a.dataset_version = ? AND a.pathogen_key = ?
                 AND a.split = 'train' AND b.split = 'test'
           )""",
        (row["dataset_version"], row["pathogen_key"]),
    ).fetchone()[0]
    if overlap:
        findings.append(
            Finding(
                "train_test_overlap", SEVERITY_CRITICAL,
                f"{overlap} molecules appear in both the train and test partitions.",
                {"n_overlap": int(overlap)},
            )
        )

    if not findings:
        findings.append(Finding("all_clear", SEVERITY_INFO, "no sanity issues detected for this model"))
    return findings


def check_dataset(conn: sqlite3.Connection, dataset_version: str) -> list[Finding]:
    """Sanity-check the data behind a dataset version."""
    findings: list[Finding] = []

    rows = conn.execute(
        """SELECT pathogen_key,
                  COUNT(*) AS n,
                  SUM(label) AS actives
           FROM dataset_members WHERE dataset_version = ?
           GROUP BY pathogen_key""",
        (dataset_version,),
    ).fetchall()

    for row in rows:
        n = int(row["n"])
        actives = int(row["actives"] or 0)
        fraction = actives / n if n else 0.0
        if fraction >= 0.85 or fraction <= 0.15:
            findings.append(
                Finding(
                    "class_imbalance", SEVERITY_WARNING,
                    f"{row['pathogen_key']}: {fraction:.0%} of compounds are active. "
                    "ChEMBL is publication-biased towards actives; treat absolute metrics with care.",
                    {"pathogen": row["pathogen_key"], "n": n, "active_fraction": fraction},
                )
            )

    # Resistance-phenotype coverage. A pathogen named for its resistance
    # (MRSA, carbapenem-resistant K. pneumoniae) whose training evidence comes
    # overwhelmingly from susceptible reference strains supports a claim about
    # antibacterial activity only - not about the resistant organism.
    for row in conn.execute(
        """SELECT dm.pathogen_key,
                  COUNT(*) AS labelled,
                  SUM(b.strain_specific) AS flagged
           FROM dataset_members dm
           JOIN bioactivity b ON b.molecule_id = dm.molecule_id
                             AND b.pathogen_key = dm.pathogen_key
           WHERE dm.dataset_version = ? AND b.label IS NOT NULL
           GROUP BY dm.pathogen_key""",
        (dataset_version,),
    ).fetchall():
        labelled = int(row["labelled"] or 0)
        flagged = int(row["flagged"] or 0)
        if not labelled:
            continue
        fraction = flagged / labelled
        if fraction < 0.25:
            findings.append(
                Finding(
                    "resistance_phenotype_coverage", SEVERITY_WARNING,
                    f"{row['pathogen_key']}: only {fraction:.1%} of labelled records come from an "
                    "assay that names a resistant strain. This model predicts antibacterial "
                    "activity against the species, not activity against the resistant phenotype.",
                    {
                        "pathogen": row["pathogen_key"],
                        "labelled_records": labelled,
                        "resistant_strain_records": flagged,
                        "fraction": fraction,
                    },
                )
            )

    # Scaffold leakage: the whole point of a scaffold split is that a scaffold
    # lives on one side of the partition. A scaffold string that carries
    # stereochemistry would let two enantiomers count as different chemistry and
    # land in train and test, which inflates the test metric. The comparison
    # below strips stereochemistry before grouping, so it catches that case even
    # if the stored scaffolds were written by an older build.
    straddling = conn.execute(
        """SELECT m.murcko_scaffold, dm.pathogen_key, COUNT(DISTINCT dm.split) AS n_splits
           FROM dataset_members dm
           JOIN molecules m ON m.molecule_id = dm.molecule_id
           WHERE dm.dataset_version = ?
           GROUP BY m.murcko_scaffold, dm.pathogen_key
           HAVING n_splits > 1""",
        (dataset_version,),
    ).fetchall()
    if straddling:
        findings.append(
            Finding(
                "scaffold_leakage", SEVERITY_CRITICAL,
                f"{len(straddling)} scaffolds appear in more than one split. A scaffold split "
                "must keep a scaffold whole; test metrics from this dataset are not trustworthy.",
                {
                    "n_scaffolds": len(straddling),
                    "examples": [dict(r) for r in straddling[:5]],
                },
            )
        )

    stereo_pairs = conn.execute(
        """SELECT COUNT(*) FROM (
               SELECT m.inchi, dm.pathogen_key
               FROM dataset_members dm
               JOIN molecules m ON m.molecule_id = dm.molecule_id
               WHERE dm.dataset_version = ? AND m.inchi IS NOT NULL
               GROUP BY SUBSTR(m.inchikey, 1, 14), dm.pathogen_key
               HAVING COUNT(DISTINCT dm.split) > 1
           )""",
        (dataset_version,),
    ).fetchone()[0]
    if stereo_pairs:
        findings.append(
            Finding(
                "stereoisomer_leakage", SEVERITY_CRITICAL,
                f"{stereo_pairs} structures share a connectivity skeleton (InChIKey block 1) with a "
                "molecule in a different split. Stereoisomers are near-identical to a fingerprint "
                "model, so this is leakage.",
                {"n_groups": int(stereo_pairs)},
            )
        )

    # Identical structures reaching the dataset under different identifiers.
    dupes = conn.execute(
        """SELECT COUNT(*) FROM (
               SELECT m.canonical_smiles, dm.pathogen_key
               FROM dataset_members dm
               JOIN molecules m ON m.molecule_id = dm.molecule_id
               WHERE dm.dataset_version = ?
               GROUP BY m.canonical_smiles, dm.pathogen_key
               HAVING COUNT(*) > 1
           )""",
        (dataset_version,),
    ).fetchone()[0]
    if dupes:
        findings.append(
            Finding(
                "duplicate_structures", SEVERITY_WARNING,
                f"{dupes} canonical structures appear more than once within a pathogen's dataset.",
                {"n_duplicate_groups": int(dupes)},
            )
        )

    # Organism strings that do not match any configured pathogen organism.
    stray = conn.execute(
        """SELECT DISTINCT b.organism, b.pathogen_key
           FROM bioactivity b JOIN pathogens p ON p.key = b.pathogen_key
           WHERE b.organism IS NOT NULL AND LOWER(b.organism) NOT LIKE '%' || LOWER(p.organism) || '%'
           LIMIT 10"""
    ).fetchall()
    if stray:
        findings.append(
            Finding(
                "organism_mismatch", SEVERITY_WARNING,
                f"{len(stray)} bioactivity records carry an organism that does not match their "
                "assigned pathogen.",
                {"examples": [dict(r) for r in stray]},
            )
        )

    # Impossible potencies: a non-positive or absurdly large standard value.
    impossible = conn.execute(
        "SELECT COUNT(*) FROM bioactivity WHERE activity_value IS NOT NULL AND activity_value <= 0"
    ).fetchone()[0]
    if impossible:
        findings.append(
            Finding(
                "impossible_activity_values", SEVERITY_WARNING,
                f"{impossible} records carry a non-positive activity value; these are unusable and "
                "were left unlabelled.",
                {"count": int(impossible)},
            )
        )

    if not findings:
        findings.append(Finding("all_clear", SEVERITY_INFO, "no sanity issues detected for this dataset"))
    return findings


def summarize(findings: list[Finding]) -> dict[str, Any]:
    return {
        "n_findings": len([f for f in findings if f.check != "all_clear"]),
        "critical": [f.message for f in findings if f.severity == SEVERITY_CRITICAL],
        "warnings": [f.message for f in findings if f.severity == SEVERITY_WARNING],
    }
