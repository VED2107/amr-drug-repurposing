"""Trace one medicine through the worker, end to end, without writing anything.

    docker run --rm --env-file worker.env amr-worker:latest --trace CHEMBL295698

Reads the medicine's live record from ChEMBL, standardises its structure with
the worker's standardiser, builds the production features, scores them with the
four verified models, and sets every number beside what Supabase holds for the
same molecule. It is the path a genuinely new medicine takes, run on one whose
answer is already published, so that each step can be checked.

Nothing is written: not a molecule, not a prediction, not a run record.
"""

from __future__ import annotations

from typing import Any, Callable

from ..ingestion.http import HttpClient
from ..logging_utils import get_logger
from .features import FeatureSettings, featurise

log = get_logger("amr.updater.trace")


def fetch_chembl_molecule(cfg: Any, chembl_id: str) -> dict[str, Any]:
    base = cfg.get("ingestion", "chembl", "base_url").rstrip("/")
    url = f"{base}/molecule/{chembl_id}.json"
    response = HttpClient(cfg).get(url)
    return response.json()


def trace(
    chembl_id: str,
    *,
    cfg: Any,
    resolve: Callable[[str], Any],
    settings: FeatureSettings,
    loaded: dict[str, Any],
    store: Any,
) -> int:
    record = fetch_chembl_molecule(cfg, chembl_id)
    structures = record.get("molecule_structures") or {}
    source_smiles = (structures.get("canonical_smiles") or "").strip()

    log.info("[TRACE] 1 source      ChEMBL %s  %s  max_phase=%s",
             chembl_id, record.get("pref_name"), record.get("max_phase"))
    if not source_smiles:
        log.error("[TRACE] ChEMBL has no structure for %s; nothing is scored", chembl_id)
        return 6
    log.info("[TRACE]   source SMILES   %s", source_smiles)

    std = resolve(source_smiles)
    if std is None or not std.is_valid:
        log.error("[TRACE] the structure did not standardise; nothing is scored")
        return 6
    log.info("[TRACE] 2 standardised  molecule_id %s", std.molecule_id)
    log.info("[TRACE]   canonical SMILES %s", std.canonical_smiles)

    features, _ = featurise(std.canonical_smiles, settings)
    on_bits = [int(i) for i in features[0].nonzero()[0]]
    log.info(
        "[TRACE] 3 fingerprint   Morgan r=%d, %d bits, chirality=%s: %d bits set, first %s",
        settings.radius, settings.n_bits, settings.use_chirality, len(on_bits), on_bits[:12],
    )

    versions = [m.meta.model_version for m in loaded.values()]
    published = store.published_probabilities([std.molecule_id], versions)

    log.info("[TRACE] 4 models and predictions (worker vs Supabase)")
    worst = 0.0
    missing = 0
    for pathogen, model in sorted(loaded.items()):
        version = model.meta.model_version
        worker = float(model.predict(features)[0])
        live = published.get((std.molecule_id, pathogen, version))
        if live is None:
            missing += 1
            log.info("[TRACE]   %-12s %-18s worker %.10f   Supabase: none published",
                     pathogen, version, worker)
            continue
        worst = max(worst, abs(worker - live))
        log.info("[TRACE]   %-12s %-18s worker %.10f   Supabase %.10f   diff %.1e",
                 pathogen, version, worker, live, abs(worker - live))

    log.info("[TRACE] 5 Supabase record  predictions for %s under %d models: %d found",
             std.molecule_id, len(versions), len(versions) - missing)
    log.info("[TRACE] nothing was written. Largest difference %.1e", worst)
    return 0 if missing == 0 and worst <= 1e-9 else 7
