"""Stage 1 - data ingestion.

Pulls ChEMBL bioactivity for the four target pathogens, the ChEMBL approved-drug
molecule set, and the FDA approved-product list, then maps approved products to
structures by name.

Structures are standardised here because the canonical structure is the identity
key for everything downstream. Fingerprints, descriptors and activity labels are
computed in the ``process`` stage.

Usage:
    python -m src.pipeline.ingest
    python -m src.pipeline.ingest --skip-drugs --max-activities 2000
"""

from __future__ import annotations

import argparse
import sqlite3
from typing import Any

from ..chemistry import standardize_smiles
from ..config import Config, load_config
from ..db import init_db, record_source, session, utcnow
from ..ingestion.chembl import ChemblClient
from ..ingestion.http import HttpClient, NetworkDisabledError
from ..ingestion.orange_book import (
    OrangeBookClient,
    build_name_index,
    product_rows,
)
from ..logging_utils import get_logger, setup_logging
from .runlog import STATUS_SKIPPED, PipelineRun, stage_run

log = get_logger("amr.ingest")


def _upsert_molecule(
    conn: sqlite3.Connection, cfg: Config, smiles: str, *,
    chembl_id: str | None = None, pref_name: str | None = None,
) -> tuple[str | None, bool, str | None]:
    """Standardise and store one molecule. Returns (molecule_id, is_new, error)."""
    std_cfg = cfg.get("chemistry", "standardization", default={}) or {}
    record = standardize_smiles(
        smiles,
        strip_salts=bool(std_cfg.get("strip_salts", True)),
        min_heavy_atoms=int(std_cfg.get("min_heavy_atoms", 5)),
        max_heavy_atoms=int(std_cfg.get("max_heavy_atoms", 150)),
    )

    if not record.is_valid:
        # Invalid structures are still recorded, keyed by their input, so the
        # data-quality audit can count and explain them.
        invalid_id = f"INVALID-{abs(hash(str(smiles)))%10**16:016d}"
        conn.execute(
            """INSERT INTO molecules(molecule_id, chembl_id, pref_name, input_smiles,
                   is_valid, validation_error, created_at, updated_at)
               VALUES(?,?,?,?,0,?,?,?)
               ON CONFLICT(molecule_id) DO UPDATE SET
                   validation_error = excluded.validation_error, updated_at = excluded.updated_at""",
            (invalid_id, chembl_id, pref_name, str(smiles)[:500] if smiles else None,
             record.error, utcnow(), utcnow()),
        )
        return None, False, record.error

    existing = conn.execute(
        "SELECT molecule_id FROM molecules WHERE molecule_id = ?", (record.molecule_id,)
    ).fetchone()

    conn.execute(
        """INSERT INTO molecules(molecule_id, chembl_id, pref_name, input_smiles,
               canonical_smiles, inchi, inchikey, murcko_scaffold, heavy_atoms,
               is_valid, validation_error, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,1,NULL,?,?)
           ON CONFLICT(molecule_id) DO UPDATE SET
               chembl_id = COALESCE(molecules.chembl_id, excluded.chembl_id),
               pref_name = COALESCE(molecules.pref_name, excluded.pref_name),
               canonical_smiles = excluded.canonical_smiles,
               inchi = excluded.inchi,
               inchikey = excluded.inchikey,
               murcko_scaffold = excluded.murcko_scaffold,
               heavy_atoms = excluded.heavy_atoms,
               is_valid = 1,
               validation_error = NULL,
               updated_at = excluded.updated_at""",
        (
            record.molecule_id, chembl_id, pref_name, record.input_smiles,
            record.canonical_smiles, record.inchi, record.inchikey,
            record.murcko_scaffold, record.heavy_atoms, utcnow(), utcnow(),
        ),
    )
    return record.molecule_id, existing is None, None


def _has_carbon(smiles: str | None) -> bool:
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles or "")
    return mol is not None and any(a.GetAtomicNum() == 6 for a in mol.GetAtoms())


def ingest_bioactivity(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, *, max_activities: int | None = None
) -> None:
    """Fetch and store ChEMBL bioactivity for every configured pathogen."""
    client = ChemblClient(cfg)
    try:
        for pathogen in cfg.pathogens:
            try:
                records = list(client.iter_activities(pathogen, limit=max_activities))
            except Exception as exc:
                run.record_error(f"chembl:{pathogen.key}", exc)
                continue

            inserted = 0
            for rec in records:
                run.processed += 1
                try:
                    molecule_id, is_new, error = _upsert_molecule(
                        conn, cfg, rec.get("canonical_smiles"),
                        chembl_id=rec.get("molecule_chembl_id"),
                        pref_name=rec.get("molecule_pref_name"),
                    )
                    if molecule_id is None:
                        run.skipped += 1
                        continue
                    if is_new:
                        run.new += 1

                    cursor = conn.execute(
                        """INSERT INTO bioactivity(
                               source_activity_id, source, molecule_id, chembl_id, pathogen_key,
                               organism, target_chembl_id, target_pref_name, assay_chembl_id,
                               assay_description, assay_type, activity_type, activity_value,
                               activity_units, activity_relation, pchembl_value, pactivity,
                               pactivity_method, label, label_reason, strain_specific,
                               document_chembl_id, document_year, is_demo, created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,?,0,?)
                           ON CONFLICT(source, source_activity_id) DO NOTHING""",
                        (
                            str(rec.get("activity_id")), "ChEMBL", molecule_id,
                            rec.get("molecule_chembl_id"), pathogen.key,
                            rec.get("target_organism"), rec.get("target_chembl_id"),
                            rec.get("target_pref_name"), rec.get("assay_chembl_id"),
                            (rec.get("assay_description") or "")[:1000], rec.get("assay_type"),
                            rec.get("standard_type"), rec.get("standard_value"),
                            rec.get("standard_units"), rec.get("standard_relation"),
                            rec.get("pchembl_value"),
                            int(pathogen.is_resistant_strain_assay(rec.get("assay_description"))),
                            rec.get("document_chembl_id"), rec.get("document_year"), utcnow(),
                        ),
                    )
                    inserted += cursor.rowcount if cursor.rowcount > 0 else 0
                except Exception as exc:
                    run.record_error(f"activity:{rec.get('activity_id')}", exc)

            conn.commit()
            record_source(conn, f"ChEMBL activities ({pathogen.label})",
                          cfg.get("ingestion", "chembl", "base_url"), inserted,
                          notes=f"organism={pathogen.organism}")
            log.info("%s: stored %d new bioactivity rows", pathogen.label, inserted)
            run.note(f"bioactivity_{pathogen.key}", inserted)
    finally:
        client.close()


def ingest_approved_drugs(conn: sqlite3.Connection, cfg: Config, run: PipelineRun) -> None:
    """Fetch approved products from the FDA and map them to ChEMBL structures.

    The ``drugs`` table is rebuilt from the sources on every run rather than
    patched: an upsert that kept an earlier ``molecule_id`` whenever the new
    match was empty is how a wrong structure used to survive a corrected
    matcher. ``first_seen_at`` is carried over for rows that already existed.
    """
    http = HttpClient(cfg)
    chembl = ChemblClient(cfg, http=HttpClient(cfg))
    ob = OrangeBookClient(cfg, http=http)

    try:
        approved_molecules = list(chembl.iter_approved_molecules())
        name_index = build_name_index(approved_molecules)
        log.info("built a name index over %d ChEMBL approved-drug names", len(name_index))

        # Store every approved ChEMBL molecule: this is the screening library,
        # independent of whether a given Orange Book row maps onto it.
        chembl_molecule_ids: dict[str, str] = {}
        for mol in approved_molecules:
            run.processed += 1
            molecule_id, is_new, error = _upsert_molecule(
                conn, cfg, mol["canonical_smiles"],
                chembl_id=mol.get("chembl_id"), pref_name=mol.get("pref_name"),
            )
            if molecule_id is None:
                run.skipped += 1
                continue
            if is_new:
                run.new += 1
            chembl_molecule_ids[mol["chembl_id"]] = molecule_id
        # A product's structure is its ChEMBL parent: the curated active moiety.
        # "CEFAZOLIN SODIUM" and "IMIPRAMINE PAMOATE" are salts whose own records
        # standardise to a charged anion or to the larger counter-ion (pamoic
        # acid); their parents are cefazolin and imipramine. Esters such as
        # hydrocortisone acetate are their own parents and stay distinct.
        parent_of = {m["chembl_id"]: m.get("parent_chembl_id") or m["chembl_id"] for m in approved_molecules}
        missing = sorted(set(parent_of.values()) - set(parent_of))
        for mol in chembl.molecules_by_id(missing) if missing else []:
            molecule_id, is_new, error = _upsert_molecule(
                conn, cfg, mol["canonical_smiles"],
                chembl_id=mol.get("chembl_id"), pref_name=mol.get("pref_name"),
            )
            if molecule_id is not None:
                chembl_molecule_ids[mol["chembl_id"]] = molecule_id
                run.new += int(is_new)
        conn.commit()
        record_source(conn, "ChEMBL approved molecules (max_phase=4)",
                      cfg.get("ingestion", "chembl", "base_url"), len(chembl_molecule_ids))

        # An inorganic substance (no carbon: potassium chloride, phosphoric acid,
        # sodium thiosulfate) is not a small organic molecule the models can
        # screen, so it gets no structure rather than a meaningless one.
        organic = {
            r["molecule_id"] for r in conn.execute(
                "SELECT molecule_id, canonical_smiles FROM molecules WHERE is_valid"
            ) if _has_carbon(r["canonical_smiles"])
        }

        def resolve(chembl_id: str) -> str | None:
            molecule_id = chembl_molecule_ids.get(parent_of.get(chembl_id, chembl_id))
            return molecule_id if molecule_id in organic else None

        products = ob.fetch_products()
        rows = list(product_rows(products, name_index, resolve))

        first_seen = {
            r["drug_id"]: r["first_seen_at"]
            for r in conn.execute("SELECT drug_id, first_seen_at FROM drugs")
        }
        predicted = {
            r[0] for r in conn.execute(
                """SELECT DISTINCT p.molecule_id FROM predictions p
                     JOIN model_versions m ON m.model_version = p.model_version
                    WHERE m.status = 'ACTIVE'"""
            )
        }
        conn.execute("DELETE FROM drugs")
        matched = unmatched = 0
        methods: dict[str, int] = {}
        for row in rows:
            run.processed += 1
            product = row.product
            molecule_id = resolve(row.chembl_id) if row.chembl_id else None
            if molecule_id is None:
                unmatched += 1
            else:
                matched += 1
            key = row.match_method.split("_", 3)[-1] if row.match_method.startswith("combination") else row.match_method
            methods[key] = methods.get(key, 0) + 1
            conn.execute(
                """INSERT INTO drugs(drug_id, molecule_id, generic_name, brand_name,
                       approval_source, approval_status, application_no, application_type,
                       marketing_status, dosage_form, route, approval_date, chembl_id,
                       match_method, ingredients, first_seen_at, processing_status,
                       prediction_status, is_demo)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
                (
                    row.drug_id, molecule_id, row.generic_name, product.brand_name,
                    product.source, "Approved", product.application_no,
                    product.application_type, product.marketing_status,
                    product.dosage_form, product.route, product.approval_date,
                    row.chembl_id if molecule_id else None, row.match_method, row.ingredients,
                    first_seen.get(row.drug_id, utcnow()),
                    "processed" if molecule_id else "unmatched",
                    ("predicted" if molecule_id in predicted else "pending") if molecule_id else "unavailable",
                ),
            )

        conn.commit()
        record_source(conn, ob.source_used or "FDA approved products", ob.source_url,
                      matched + unmatched, source_version=ob.source_version,
                      notes=f"structure-matched={matched}, unmatched={unmatched}")
        run.note("approved_rows_total", matched + unmatched)
        run.note("approved_rows_matched", matched)
        run.note("approved_rows_unmatched", unmatched)
        run.note("match_methods", methods)
        log.info("approved product rows: %d matched to a structure, %d not reliably matched (%s)",
                 matched, unmatched, methods)
    finally:
        ob.close()
        chembl.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest ChEMBL and FDA data")
    parser.add_argument("--skip-bioactivity", action="store_true")
    parser.add_argument("--skip-drugs", action="store_true")
    parser.add_argument("--max-activities", type=int, default=None,
                        help="cap activity records per pathogen (overrides config)")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)
        with stage_run(conn, "ingest", params=vars(args)) as run:
            if cfg.offline:
                run.status = STATUS_SKIPPED
                run.message = "AMR_OFFLINE=1: ingestion skipped"
                log.warning(run.message)
                return 0
            try:
                if not args.skip_bioactivity:
                    ingest_bioactivity(conn, cfg, run, max_activities=args.max_activities)
                if not args.skip_drugs:
                    ingest_approved_drugs(conn, cfg, run)
            except NetworkDisabledError as exc:
                run.status = STATUS_SKIPPED
                run.message = str(exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
