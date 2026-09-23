"""One update run, start to finish.

    python -m src.updater.run              # find new medicines, score, publish
    python -m src.updater.run --dry-run    # do everything except write
    python -m src.updater.run --check      # config, models and database only

The order is chosen so that a failure is never worse than doing nothing:

1. Configuration and models are validated before a source is contacted.
2. The published database is read, which is the only reliable record of what
   already exists.
3. New medicines are standardised and fingerprinted with the engine's own code.
4. Each is scored by all four ACTIVE models.
5. Molecule, product and prediction rows are written per medicine, in one
   transaction each — so an interruption leaves completed medicines valid and
   the next run resumes with the rest.

Retraining never happens here, under any flag. This worker loads models; it does
not fit them, promote them, or write to a dataset.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from typing import Any

from ..chemistry.standardize import standardize_smiles
from ..config import load_config
from ..logging_utils import get_logger, setup_logging
from .config import ConfigurationError, SUPPORTED_PATHOGENS, load_updater_config
from .features import FeatureSettings, featurise
from .integrity import load_manifest, run_known_answers
from .models import ModelIntegrityError, load_active_models
from .sources import SourceProduct, fetch_snapshot
from .store import SupabaseStore, utcnow

log = get_logger("amr.updater")

STAGE = "update"


def _standardiser(cfg):
    """The engine's standardisation, bound to the project's configured limits."""
    std_cfg = cfg.get("chemistry", "standardization", default={}) or {}

    def resolve(smiles: str):
        try:
            return standardize_smiles(
                smiles,
                strip_salts=bool(std_cfg.get("strip_salts", True)),
                min_heavy_atoms=int(std_cfg.get("min_heavy_atoms", 5)),
                max_heavy_atoms=int(std_cfg.get("max_heavy_atoms", 150)),
            )
        except Exception:  # noqa: BLE001 - a bad structure is data, not a crash
            return None

    return resolve


def _configure_logging() -> None:
    """Send the run's log to stdout.

    A container has no log directory worth writing to — whatever supervises it
    collects stdout — so the file handler is left off and the level is taken
    from the environment.
    """
    import logging
    import os

    level_name = os.environ.get("AMR_LOG_LEVEL", "INFO").strip().upper()
    setup_logging(log_dir=None, level=getattr(logging, level_name, logging.INFO))


def run_update(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Score newly published medicines with the existing ACTIVE models"
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="do everything except write to Supabase")
    parser.add_argument("--check", action="store_true",
                        help="validate configuration, models and database, then exit")
    parser.add_argument("--trace", metavar="CHEMBL_ID", default=None,
                        help="trace one medicine from its live ChEMBL record to the "
                             "published predictions; writes nothing")
    parser.add_argument("--limit", type=int, default=None,
                        help="maximum new medicines to process in this run")
    args = parser.parse_args(argv)

    _configure_logging()

    started = utcnow()
    run_id = f"UPD-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    log.info("[AMR UPDATE] run %s starting", run_id)

    try:
        config = load_updater_config()
    except ConfigurationError as exc:
        log.error("[AMR UPDATE] %s", exc)
        return 2

    dry_run = config.dry_run or args.dry_run
    max_new = args.limit or config.max_new_medicines

    log.info("[AMR UPDATE] mode: %s", "dry run (nothing is written)" if dry_run else "publish")

    cfg = load_config()
    resolve = _standardiser(cfg)
    settings = FeatureSettings.from_config(cfg)

    store = SupabaseStore(config.database_url)
    try:
        store.connect()
    except Exception as exc:  # noqa: BLE001
        log.error("[AMR UPDATE] cannot reach the database: %s", type(exc).__name__)
        return 3

    try:
        registry = store.active_models()
        if not registry:
            log.error("[AMR UPDATE] the published registry has no ACTIVE model; nothing to run")
            return 4

        try:
            loaded = load_active_models(registry, config)
        except (ConfigurationError, ModelIntegrityError) as exc:
            log.error("[AMR UPDATE] %s", exc)
            return 5

        # A pathogen with no model never receives a prediction, whatever the
        # registry or a source happens to contain.
        scoreable = [p for p in SUPPORTED_PATHOGENS if p in loaded]
        unsupported = sorted(set(registry) - set(SUPPORTED_PATHOGENS))
        if unsupported:
            log.warning(
                "[AMR UPDATE] ignoring ACTIVE models for unsupported pathogens: %s",
                ", ".join(unsupported),
            )

        model_versions = [loaded[p].meta.model_version for p in scoreable]

        # Nothing new is scored until the container has reproduced what is
        # published, through the path a new medicine takes.
        manifest = load_manifest()
        try:
            live = store.published_probabilities(
                [case["molecule_id"] for case in manifest["known_answers"]], model_versions
            )
            results = run_known_answers(
                {p: loaded[p] for p in scoreable},
                manifest,
                lambda smiles: featurise(smiles, settings)[0],
                published=live,
            )
        except ModelIntegrityError as exc:
            log.error("[AMR UPDATE] %s", exc)
            return 5
        worst = max(r.worst_difference for r in results)
        log.info(
            "[AMR UPDATE] self-test passed: %d known answers reproduced against the manifest "
            "and the live database (largest difference %.1e, tolerance %.0e)",
            len(results), worst, manifest["tolerance"],
        )

        if args.trace:
            from .trace import trace

            return trace(
                args.trace, cfg=cfg, resolve=resolve, settings=settings,
                loaded={p: loaded[p] for p in scoreable}, store=store,
            )

        published = store.published_state(model_versions)

        if args.check:
            log.info(
                "[AMR UPDATE] check passed: %d models, %d published molecules, %d predictions",
                len(scoreable), len(published.molecule_ids),
                store.count_predictions_for(model_versions),
            )
            return 0

        if config.offline:
            log.info("[AMR UPDATE] AMR_OFFLINE is set; no source will be contacted")
            return 0

        snapshot = fetch_snapshot(cfg, molecule_limit=None)

        products_by_chembl: dict[str, list[SourceProduct]] = {}
        for product in snapshot.products:
            if product.chembl_id:
                products_by_chembl.setdefault(product.chembl_id, []).append(product)

        # -- what is actually new -------------------------------------------
        new_molecules: list[tuple[Any, Any]] = []
        seen: set[str] = set()
        no_structure = snapshot.molecules_without_structure

        for molecule in snapshot.molecules:
            record = resolve(molecule.canonical_smiles)
            if record is None or not record.is_valid or not record.molecule_id:
                no_structure += 1
                continue
            if record.molecule_id in published.molecule_ids or record.molecule_id in seen:
                continue
            seen.add(record.molecule_id)
            new_molecules.append((molecule, record))
            if len(new_molecules) >= max_new:
                log.info("[AMR UPDATE] reached the run limit of %d new medicines", max_new)
                break

        log.info("[AMR UPDATE] Found %d new/changed medicines", len(new_molecules))
        if no_structure:
            log.info(
                "[AMR UPDATE] %d source records had no usable structure and were skipped, "
                "not completed from elsewhere",
                no_structure,
            )

        new_products = [
            p for p in snapshot.products if p.drug_id not in published.drug_ids
        ]
        log.info("[AMR UPDATE] %d approved products not yet published", len(new_products))

        if dry_run:
            log.info(
                "[AMR UPDATE] dry run: would publish %d medicines, %d products and up to "
                "%d predictions. Nothing was written.",
                len(new_molecules), len(new_products), len(new_molecules) * len(scoreable),
            )
            return 0

        store.start_run(
            run_id, STAGE,
            {
                "max_new_medicines": max_new,
                "models": model_versions,
                "source_molecules": len(snapshot.molecules),
            },
        )

        processed = written_predictions = errors = 0
        published_molecules = 0

        for molecule, record in new_molecules:
            log.info("[AMR UPDATE] Processing medicine %s", record.molecule_id)
            try:
                # Exactly the features src/pipeline/process.py would compute
                # for this structure (see src/updater/features.py).
                log.info("[AMR UPDATE] Generating Morgan fingerprint...")
                features, descriptors = featurise(record.canonical_smiles, settings)

                prediction_rows: list[dict[str, Any]] = []
                for pathogen in scoreable:
                    model = loaded[pathogen]
                    key = (record.molecule_id, pathogen, model.meta.model_version)
                    if key in published.scored:
                        continue
                    log.info("[AMR UPDATE] Running %s...", model.meta.model_version)
                    probability = float(model.predict(features)[0])
                    prediction_rows.append(
                        {
                            "molecule_id": record.molecule_id,
                            "pathogen_key": pathogen,
                            "probability": probability,
                            "model_version": model.meta.model_version,
                            "model_type": model.meta.model_type,
                            "dataset_version": model.meta.dataset_version,
                            "feature_version": model.meta.feature_version,
                            "predicted_at": utcnow(),
                        }
                    )

                molecule_row = {
                    "molecule_id": record.molecule_id,
                    "chembl_id": molecule.chembl_id,
                    "pref_name": molecule.pref_name,
                    "input_smiles": record.input_smiles,
                    "canonical_smiles": record.canonical_smiles,
                    "inchi": record.inchi,
                    "inchikey": record.inchikey,
                    "murcko_scaffold": record.murcko_scaffold,
                    "feature_version": cfg.get("ml", "feature_version",
                                               default="morgan-r2-1024-v1"),
                    "created_at": utcnow(),
                    "updated_at": utcnow(),
                    **{
                        field: descriptors.get(field)
                        for field in (
                            "mw", "logp", "tpsa", "hbd", "hba", "rotatable_bonds",
                            "aromatic_rings", "heavy_atoms", "fraction_csp3", "qed",
                            "lipinski_violations",
                        )
                    },
                }

                # One medicine, one transaction: an interruption leaves whole
                # medicines published rather than half of one.
                with store.transaction():
                    store.upsert_molecule(molecule_row)

                    for product in products_by_chembl.get(molecule.chembl_id or "", []):
                        if product.drug_id in published.drug_ids:
                            continue
                        store.upsert_drug(
                            {
                                "drug_id": product.drug_id,
                                "molecule_id": record.molecule_id,
                                "generic_name": product.generic_name,
                                "brand_name": product.brand_name,
                                "approval_source": product.approval_source,
                                "approval_status": "Approved",
                                "application_no": product.application_no,
                                "application_type": product.application_type,
                                "marketing_status": product.marketing_status,
                                "dosage_form": product.dosage_form,
                                "route": product.route,
                                "approval_date": product.approval_date,
                                "chembl_id": product.chembl_id,
                                "match_method": product.match_method,
                                "first_seen_at": utcnow(),
                                "processing_status": "processed",
                                "prediction_status": "scored" if prediction_rows else "pending",
                            }
                        )

                    if prediction_rows:
                        log.info("[AMR UPDATE] Publishing results to Supabase...")
                        written_predictions += store.insert_predictions(prediction_rows)

                published_molecules += 1
                processed += 1

            except Exception as exc:  # noqa: BLE001 - one bad medicine is not a failed run
                errors += 1
                processed += 1
                message = f"{type(exc).__name__}: {exc}"
                log.error("[AMR UPDATE] %s failed: %s", record.molecule_id, message)
                try:
                    store.record_error(run_id, STAGE, record.molecule_id, message)
                except Exception:  # pragma: no cover
                    log.exception("[AMR UPDATE] could not record the error")

        # -- provenance for the sources consulted -----------------------------
        if snapshot.chembl_url:
            store.record_source(
                "ChEMBL approved molecules (max_phase=4)",
                snapshot.chembl_url,
                len(snapshot.molecules),
                notes=f"update run {run_id}; {no_structure} records had no usable structure",
            )
        if snapshot.orange_book_url:
            store.record_source(
                "FDA Orange Book",
                snapshot.orange_book_url,
                len(snapshot.products),
                source_version=snapshot.orange_book_version,
                notes=f"update run {run_id}; {snapshot.products_unmatched} unmatched",
            )

        status = "SUCCESS" if errors == 0 else "PARTIAL"
        store.finish_run(
            run_id,
            status=status,
            processed=processed,
            new=published_molecules,
            skipped=no_structure,
            errors=errors,
            message=(
                f"{published_molecules} medicines published, "
                f"{written_predictions} predictions written with "
                f"{', '.join(model_versions)}"
            ),
            started=started,
        )

        log.info(
            "[AMR UPDATE] Completed: %d medicines processed, %d predictions written, "
            "%d errors (run %s)",
            processed, written_predictions, errors, run_id,
        )
        return 0 if errors == 0 else 1

    finally:
        store.close()


def main(argv: list[str] | None = None) -> int:
    try:
        return run_update(argv)
    except KeyboardInterrupt:
        log.warning("[AMR UPDATE] interrupted; completed medicines remain published")
        return 130


if __name__ == "__main__":
    sys.exit(main())
