"""Stage 2 - molecular processing and activity labelling.

Computes fingerprints and descriptors for molecules that do not have them yet,
then derives pActivity and a binary label for every unlabelled bioactivity
record. Both passes are incremental: unchanged molecules are never recomputed.

Usage:
    python -m src.pipeline.process
    python -m src.pipeline.process --force   # recompute everything
"""

from __future__ import annotations

import argparse
import sqlite3

from rdkit import Chem

from ..chemistry import compute_descriptors, fingerprint_to_blob, morgan_fingerprint
from ..chemistry.standardize import murcko_scaffold_for
from ..config import Config, load_config
from ..db import init_db, session, utcnow
from ..logging_utils import get_logger, setup_logging
from ..ml.labeling import label_measurement
from .runlog import PipelineRun, stage_run

log = get_logger("amr.process")


def process_molecules(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, *, force: bool = False,
    batch_size: int = 500,
) -> None:
    """Compute fingerprints and descriptors for molecules that need them."""
    fp_cfg = cfg.get("chemistry", "fingerprint", default={}) or {}
    desc_limits = cfg.get("chemistry", "descriptors", default={}) or {}
    feature_version = cfg.get("ml", "feature_version", default="morgan-r2-1024-v1")

    where = "is_valid = 1 AND canonical_smiles IS NOT NULL"
    if not force:
        where += " AND (fingerprint IS NULL OR feature_version IS NOT ? )"

    params = () if force else (feature_version,)
    rows = conn.execute(
        f"SELECT molecule_id, canonical_smiles FROM molecules WHERE {where}", params
    ).fetchall()

    log.info("processing %d molecules (force=%s)", len(rows), force)
    pending: list[tuple] = []

    for row in rows:
        run.processed += 1
        try:
            mol = Chem.MolFromSmiles(row["canonical_smiles"])
            if mol is None:
                raise ValueError("canonical SMILES failed to re-parse")

            fp = morgan_fingerprint(
                mol,
                radius=int(fp_cfg.get("radius", 2)),
                n_bits=int(fp_cfg.get("n_bits", 1024)),
                use_chirality=bool(fp_cfg.get("use_chirality", False)),
            )
            desc = compute_descriptors(mol, lipinski_limits=desc_limits)

            pending.append(
                (
                    fingerprint_to_blob(fp), feature_version, murcko_scaffold_for(mol),
                    desc["mw"], desc["logp"], desc["tpsa"], desc["hbd"], desc["hba"],
                    desc["rotatable_bonds"], desc["aromatic_rings"], desc["heavy_atoms"],
                    desc["fraction_csp3"], desc["qed"], desc["lipinski_violations"],
                    utcnow(), row["molecule_id"],
                )
            )
            run.new += 1
        except Exception as exc:
            run.record_error(row["molecule_id"], exc)

        if len(pending) >= batch_size:
            _flush_molecules(conn, pending)
            pending.clear()

    if pending:
        _flush_molecules(conn, pending)
    conn.commit()
    run.note("molecules_processed", run.new)


def _flush_molecules(conn: sqlite3.Connection, rows: list[tuple]) -> None:
    conn.executemany(
        """UPDATE molecules SET
               fingerprint = ?, feature_version = ?, murcko_scaffold = ?,
               mw = ?, logp = ?, tpsa = ?,
               hbd = ?, hba = ?, rotatable_bonds = ?, aromatic_rings = ?,
               heavy_atoms = ?, fraction_csp3 = ?, qed = ?, lipinski_violations = ?,
               updated_at = ?
           WHERE molecule_id = ?""",
        rows,
    )
    conn.commit()


def label_bioactivity(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, *, force: bool = False
) -> None:
    """Derive pActivity and a binary label for unlabelled bioactivity records."""
    lab = cfg.get("labeling", default={}) or {}
    active_threshold = float(lab.get("active_threshold_pactivity", 5.0))
    inactive_threshold = float(lab.get("inactive_threshold_pactivity", 4.0))
    honour_censored = bool(lab.get("honour_censored_relations", True))

    where = "" if force else "WHERE b.pactivity IS NULL"
    rows = conn.execute(
        f"""SELECT b.activity_id, b.activity_value, b.activity_units, b.activity_relation,
                   b.pchembl_value, m.mw
            FROM bioactivity b
            LEFT JOIN molecules m ON m.molecule_id = b.molecule_id
            {where}"""
    ).fetchall()

    log.info("labelling %d bioactivity records", len(rows))
    updates: list[tuple] = []
    counts = {"active": 0, "inactive": 0, "ambiguous": 0}

    for row in rows:
        run.processed += 1
        try:
            result = label_measurement(
                row["activity_value"], row["activity_units"], row["activity_relation"],
                pchembl_value=row["pchembl_value"], molecular_weight=row["mw"],
                active_threshold=active_threshold, inactive_threshold=inactive_threshold,
                honour_censored=honour_censored,
            )
            updates.append(
                (result.pactivity, result.method, result.label, result.reason[:500], row["activity_id"])
            )
            if result.label == 1:
                counts["active"] += 1
            elif result.label == 0:
                counts["inactive"] += 1
            else:
                counts["ambiguous"] += 1
        except Exception as exc:
            run.record_error(f"activity:{row['activity_id']}", exc)

    if updates:
        conn.executemany(
            """UPDATE bioactivity SET pactivity = ?, pactivity_method = ?,
                   label = ?, label_reason = ? WHERE activity_id = ?""",
            updates,
        )
        conn.commit()

    run.new += counts["active"] + counts["inactive"]
    run.skipped += counts["ambiguous"]
    run.note("labels", counts)
    log.info(
        "labelling result: %d active, %d inactive, %d ambiguous/unusable",
        counts["active"], counts["inactive"], counts["ambiguous"],
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standardise, fingerprint and label")
    parser.add_argument("--force", action="store_true", help="recompute everything")
    parser.add_argument("--skip-labels", action="store_true")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)
        with stage_run(conn, "process", params=vars(args)) as run:
            process_molecules(conn, cfg, run, force=args.force)
            if not args.skip_labels:
                label_bioactivity(conn, cfg, run, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
