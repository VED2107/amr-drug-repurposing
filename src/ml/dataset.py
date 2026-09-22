"""Versioned training-dataset construction.

A dataset version is a frozen, content-addressed snapshot of the labelled
compound/pathogen pairs available at a point in time. Models record the dataset
version they were trained on, so any reported metric can be traced back to
exactly the rows that produced it.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from ..config import Config
from ..db import utcnow
from ..logging_utils import get_logger
from .labeling import aggregate_labels

log = get_logger("amr.dataset")


@dataclass
class PathogenDataset:
    """The labelled rows available for one pathogen."""

    pathogen_key: str
    molecule_ids: list[str] = field(default_factory=list)
    scaffolds: list[str] = field(default_factory=list)
    labels: list[int] = field(default_factory=list)
    pactivities: list[float] = field(default_factory=list)
    n_measurements: list[int] = field(default_factory=list)
    fingerprints: np.ndarray | None = None
    trainable: bool = False
    reason: str = ""

    @property
    def n(self) -> int:
        return len(self.molecule_ids)

    @property
    def n_active(self) -> int:
        return sum(self.labels)

    @property
    def n_inactive(self) -> int:
        return self.n - self.n_active

    def summary(self) -> dict[str, Any]:
        return {
            "pathogen": self.pathogen_key,
            "n_compounds": self.n,
            "n_active": self.n_active,
            "n_inactive": self.n_inactive,
            "active_fraction": (self.n_active / self.n) if self.n else None,
            "n_scaffolds": len(set(self.scaffolds)),
            "trainable": self.trainable,
            "reason": self.reason,
        }


def _dataset_version_id(config_hash: str, content_hash: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"DS-{stamp}-{content_hash[:8]}-{config_hash[:6]}"


def labeling_signature(cfg: Config) -> tuple[str, dict[str, Any]]:
    """Hash of every setting that can change a label, plus the settings themselves."""
    payload = {
        "labeling": cfg.get("labeling", default={}),
        "fingerprint": cfg.get("chemistry", "fingerprint", default={}),
        "feature_version": cfg.get("ml", "feature_version"),
        "accepted_activity_types": cfg.get("ingestion", "chembl", "accepted_activity_types", default=[]),
        "accepted_units": cfg.get("ingestion", "chembl", "accepted_units", default=[]),
    }
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest(), payload


def build_pathogen_dataset(
    conn: sqlite3.Connection, cfg: Config, pathogen_key: str
) -> PathogenDataset:
    """Aggregate labelled bioactivity into one row per compound for a pathogen."""
    aggregation = cfg.get("labeling", "duplicate_aggregation", default="median")
    min_records = int(cfg.get("labeling", "min_records_per_pathogen", default=150))
    min_minority = int(cfg.get("labeling", "min_minority_class_records", default=30))

    rows = conn.execute(
        """
        SELECT b.molecule_id, b.label, b.pactivity, m.murcko_scaffold, m.fingerprint
        FROM bioactivity b
        JOIN molecules m ON m.molecule_id = b.molecule_id
        WHERE b.pathogen_key = ?
          AND b.label IS NOT NULL
          AND b.pactivity IS NOT NULL
          AND m.is_valid = 1
          AND m.fingerprint IS NOT NULL
        """,
        (pathogen_key,),
    ).fetchall()

    ds = PathogenDataset(pathogen_key=pathogen_key)

    if not rows:
        ds.reason = "no labelled bioactivity records with valid structures"
        return ds

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = grouped.setdefault(
            row["molecule_id"],
            {
                "pactivities": [],
                "labels": [],
                "scaffold": row["murcko_scaffold"] or "__acyclic__",
                "fingerprint": row["fingerprint"],
            },
        )
        entry["pactivities"].append(float(row["pactivity"]))
        entry["labels"].append(int(row["label"]))

    from ..chemistry.fingerprints import fingerprint_from_blob

    n_bits = int(cfg.get("chemistry", "fingerprint", "n_bits", default=1024))
    fps: list[np.ndarray] = []

    for molecule_id, entry in sorted(grouped.items()):
        pact, label = aggregate_labels(entry["pactivities"], entry["labels"], aggregation)
        try:
            fp = fingerprint_from_blob(entry["fingerprint"], n_bits)
        except Exception as exc:
            log.warning("skipping %s: unusable fingerprint (%s)", molecule_id, exc)
            continue
        ds.molecule_ids.append(molecule_id)
        ds.scaffolds.append(entry["scaffold"])
        ds.labels.append(int(label))
        ds.pactivities.append(float(pact))
        ds.n_measurements.append(len(entry["labels"]))
        fps.append(fp)

    ds.fingerprints = np.vstack(fps) if fps else np.zeros((0, n_bits), dtype=np.uint8)

    # Trainability gate. Reporting an untrainable pathogen honestly is required
    # by the project brief; fabricating a model for it is not an option.
    minority = min(ds.n_active, ds.n_inactive)
    if ds.n < min_records:
        ds.reason = f"only {ds.n} labelled compounds, below the {min_records}-compound minimum"
    elif minority < min_minority:
        ds.reason = (
            f"minority class has {minority} compounds, below the {min_minority}-compound minimum "
            f"(active={ds.n_active}, inactive={ds.n_inactive})"
        )
    else:
        ds.trainable = True
        ds.reason = "sufficient labelled data"

    return ds


def data_quality_audit(conn: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    """Pre-training data audit, stored with the dataset version."""
    def scalar(sql: str, params: tuple = ()) -> int:
        row = conn.execute(sql, params).fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    audit: dict[str, Any] = {
        "generated_at": utcnow(),
        "molecules_total": scalar("SELECT COUNT(*) FROM molecules"),
        "molecules_valid": scalar("SELECT COUNT(*) FROM molecules WHERE is_valid = 1"),
        "molecules_invalid": scalar("SELECT COUNT(*) FROM molecules WHERE is_valid = 0"),
        "molecules_missing_smiles": scalar(
            "SELECT COUNT(*) FROM molecules WHERE canonical_smiles IS NULL OR canonical_smiles = ''"
        ),
        "molecules_with_fingerprint": scalar("SELECT COUNT(*) FROM molecules WHERE fingerprint IS NOT NULL"),
        "bioactivity_total": scalar("SELECT COUNT(*) FROM bioactivity"),
        "bioactivity_labelled": scalar("SELECT COUNT(*) FROM bioactivity WHERE label IS NOT NULL"),
        "bioactivity_ambiguous": scalar("SELECT COUNT(*) FROM bioactivity WHERE label IS NULL"),
        "unique_compounds_with_activity": scalar(
            "SELECT COUNT(DISTINCT molecule_id) FROM bioactivity WHERE molecule_id IS NOT NULL"
        ),
    }

    invalid_reasons = conn.execute(
        """SELECT validation_error, COUNT(*) AS n FROM molecules
           WHERE is_valid = 0 AND validation_error IS NOT NULL
           GROUP BY validation_error ORDER BY n DESC LIMIT 10"""
    ).fetchall()
    audit["invalid_reasons"] = [{"reason": r["validation_error"], "count": int(r["n"])} for r in invalid_reasons]

    unit_rows = conn.execute(
        """SELECT activity_units, COUNT(*) AS n FROM bioactivity
           GROUP BY activity_units ORDER BY n DESC LIMIT 12"""
    ).fetchall()
    audit["activity_units"] = [{"units": r["activity_units"], "count": int(r["n"])} for r in unit_rows]

    type_rows = conn.execute(
        """SELECT activity_type, COUNT(*) AS n FROM bioactivity
           GROUP BY activity_type ORDER BY n DESC LIMIT 12"""
    ).fetchall()
    audit["activity_types"] = [{"type": r["activity_type"], "count": int(r["n"])} for r in type_rows]

    per_pathogen = []
    for p in cfg.pathogens:
        row = conn.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN label = 1 THEN 1 ELSE 0 END) AS actives,
                      SUM(CASE WHEN label = 0 THEN 1 ELSE 0 END) AS inactives,
                      SUM(CASE WHEN label IS NULL THEN 1 ELSE 0 END) AS ambiguous,
                      COUNT(DISTINCT molecule_id) AS compounds
               FROM bioactivity WHERE pathogen_key = ?""",
            (p.key,),
        ).fetchone()

        # Resistance-phenotype coverage. This is the single most consequential
        # caveat in the project: a model trained mostly on susceptible reference
        # strains predicts ANTIBACTERIAL ACTIVITY, not activity against the
        # resistant organism the pathogen is named for.
        strain = conn.execute(
            """SELECT COUNT(*) AS labelled,
                      SUM(strain_specific) AS flagged,
                      COUNT(DISTINCT molecule_id) AS compounds,
                      COUNT(DISTINCT CASE WHEN strain_specific = 1 THEN molecule_id END) AS flagged_compounds
               FROM bioactivity WHERE pathogen_key = ? AND label IS NOT NULL""",
            (p.key,),
        ).fetchone()
        labelled = int(strain["labelled"] or 0)
        flagged = int(strain["flagged"] or 0)
        compounds = int(strain["compounds"] or 0)
        flagged_compounds = int(strain["flagged_compounds"] or 0)

        per_pathogen.append(
            {
                "pathogen": p.key,
                "label": p.label,
                "records": int(row["total"] or 0),
                "actives": int(row["actives"] or 0),
                "inactives": int(row["inactives"] or 0),
                "ambiguous": int(row["ambiguous"] or 0),
                "unique_compounds": int(row["compounds"] or 0),
                "labelled_records": labelled,
                "resistant_strain_records": flagged,
                "resistant_strain_fraction": (flagged / labelled) if labelled else None,
                "resistant_strain_compounds": flagged_compounds,
                "resistant_strain_compound_fraction": (
                    flagged_compounds / compounds if compounds else None
                ),
            }
        )
    audit["per_pathogen"] = per_pathogen

    # Duplicate detection: the same structure appearing under several ChEMBL ids
    # is expected (salt forms collapse to one parent) and is worth surfacing.
    dupes = conn.execute(
        """SELECT COUNT(*) FROM (
               SELECT canonical_smiles FROM molecules
               WHERE is_valid = 1 AND canonical_smiles IS NOT NULL
               GROUP BY canonical_smiles HAVING COUNT(*) > 1
           )"""
    ).fetchone()
    audit["duplicate_canonical_smiles_groups"] = int(dupes[0] or 0)

    return audit


def create_dataset_version(
    conn: sqlite3.Connection,
    cfg: Config,
    datasets: dict[str, PathogenDataset],
    *,
    notes: str = "",
) -> str:
    """Persist a dataset version and its member rows. Returns the version id."""
    config_hash, labeling_payload = labeling_signature(cfg)

    # Content hash over the actual (molecule, pathogen, label) triples so an
    # identical dataset always yields an identical version id.
    hasher = hashlib.sha256()
    for key in sorted(datasets):
        ds = datasets[key]
        for mid, label in sorted(zip(ds.molecule_ids, ds.labels)):
            hasher.update(f"{key}|{mid}|{label}".encode("utf-8"))
    content_hash = hasher.hexdigest()

    version = _dataset_version_id(config_hash, content_hash)

    existing = conn.execute(
        "SELECT dataset_version FROM dataset_versions WHERE dataset_version = ?", (version,)
    ).fetchone()
    if existing:
        log.info("dataset version %s already exists; reusing it", version)
        return version

    audit = data_quality_audit(conn, cfg)
    audit["pathogen_datasets"] = {k: v.summary() for k, v in datasets.items()}

    n_records = sum(ds.n for ds in datasets.values())
    n_compounds = len({mid for ds in datasets.values() for mid in ds.molecule_ids})

    conn.execute(
        """INSERT INTO dataset_versions(dataset_version, created_at, n_records, n_compounds,
                                        n_pathogens, labeling_json, quality_json, config_hash,
                                        artifact_path, notes)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (
            version, utcnow(), n_records, n_compounds, len(datasets),
            json.dumps(labeling_payload, default=str), json.dumps(audit, default=str),
            config_hash, None, notes,
        ),
    )

    rows = []
    for key, ds in datasets.items():
        for i in range(ds.n):
            rows.append(
                (version, ds.molecule_ids[i], key, int(ds.labels[i]),
                 float(ds.pactivities[i]), int(ds.n_measurements[i]), None, ds.scaffolds[i])
            )
    if rows:
        conn.executemany(
            """INSERT OR REPLACE INTO dataset_members
               (dataset_version, molecule_id, pathogen_key, label, pactivity,
                n_measurements, split, scaffold)
               VALUES(?,?,?,?,?,?,?,?)""",
            rows,
        )

    conn.commit()
    log.info("created dataset version %s: %d rows, %d unique compounds", version, n_records, n_compounds)
    return version


def record_splits(
    conn: sqlite3.Connection,
    dataset_version: str,
    pathogen_key: str,
    molecule_ids: list[str],
    assignments: list[str],
) -> None:
    """Store which partition each compound landed in, for auditability."""
    conn.executemany(
        """UPDATE dataset_members SET split = ?
           WHERE dataset_version = ? AND pathogen_key = ? AND molecule_id = ?""",
        [(split, dataset_version, pathogen_key, mid) for mid, split in zip(molecule_ids, assignments)],
    )
    conn.commit()


def load_dataset_version(
    conn: sqlite3.Connection, cfg: Config, dataset_version: str
) -> dict[str, PathogenDataset]:
    """Rehydrate a stored dataset version, including fingerprints."""
    from ..chemistry.fingerprints import fingerprint_from_blob

    n_bits = int(cfg.get("chemistry", "fingerprint", "n_bits", default=1024))
    rows = conn.execute(
        """SELECT dm.pathogen_key, dm.molecule_id, dm.label, dm.pactivity,
                  dm.n_measurements, dm.scaffold, m.fingerprint
           FROM dataset_members dm
           JOIN molecules m ON m.molecule_id = dm.molecule_id
           WHERE dm.dataset_version = ?
           ORDER BY dm.pathogen_key, dm.molecule_id""",
        (dataset_version,),
    ).fetchall()

    out: dict[str, PathogenDataset] = {}
    buffers: dict[str, list[np.ndarray]] = {}

    for row in rows:
        key = row["pathogen_key"]
        ds = out.setdefault(key, PathogenDataset(pathogen_key=key, trainable=True,
                                                 reason="loaded from stored dataset version"))
        ds.molecule_ids.append(row["molecule_id"])
        ds.labels.append(int(row["label"]))
        ds.pactivities.append(float(row["pactivity"]) if row["pactivity"] is not None else float("nan"))
        ds.n_measurements.append(int(row["n_measurements"] or 1))
        ds.scaffolds.append(row["scaffold"] or "__acyclic__")
        buffers.setdefault(key, []).append(fingerprint_from_blob(row["fingerprint"], n_bits))

    for key, ds in out.items():
        ds.fingerprints = np.vstack(buffers[key]) if buffers.get(key) else np.zeros((0, n_bits), np.uint8)

    return out
