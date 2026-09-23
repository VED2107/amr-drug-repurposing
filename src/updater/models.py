"""Loading the production models inside a container.

The registry records where each artifact lived on the machine that trained it,
which is an absolute Windows path. That path means nothing in a Linux container,
so the artifact is located by *file name* inside the configured models
directory, falling back to the recorded path when it happens to resolve.

This is a lookup change, not a science change. The file that is loaded is the
same artifact the pipeline loads, through the same ``joblib`` call, and the
prediction is made by the same function in :mod:`src.ml.models`. Nothing about
the model is rebuilt, re-fitted or reinterpreted here.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from ..logging_utils import get_logger
from ..ml import models as zoo
from .config import EXPECTED_ACTIVE_MODELS, ConfigurationError, UpdaterConfig
from .integrity import (
    ModelIntegrityError,
    load_manifest,
    manifest_entry,
    verify_artifact,
    verify_bundle,
    verify_libraries,
)
from .store import ActiveModel

log = get_logger("amr.updater.models")

__all__ = ["LoadedModel", "ModelIntegrityError", "load_active_models", "resolve_artifact"]


@dataclass
class LoadedModel:
    """One production model, ready to score fingerprints."""

    meta: ActiveModel
    estimator: Any
    n_features: int
    artifact: Path

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Probability of predicted activity, through the engine's own call."""
        return zoo.predict_proba(self.estimator, features)


def resolve_artifact(meta: ActiveModel, models_dir: Path) -> Path:
    """Find the artifact for a model version.

    Tried in order: the file name inside the configured directory (how it works
    in a container), then ``<model_version>.joblib`` in that directory, then the
    recorded path verbatim (how it works on the machine that trained it).
    """
    candidates: list[Path] = []

    if meta.artifact_path:
        # PureWindowsPath semantics are not available for a POSIX string, so the
        # name is taken from whichever separator the record actually used.
        raw = meta.artifact_path.replace("\\", "/")
        candidates.append(models_dir / Path(raw).name)

    candidates.append(models_dir / f"{meta.model_version}.joblib")

    if meta.artifact_path:
        candidates.append(Path(meta.artifact_path))

    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate
        except OSError:
            # An absolute Windows path on Linux can raise rather than return
            # False; that is simply a miss.
            continue

    raise ConfigurationError(
        f"no artifact found for {meta.model_version}. Looked for "
        f"{', '.join(str(c) for c in candidates)}. Mount the models directory or set "
        "AMR_MODELS_DIR."
    )


def load_active_models(
    registry: dict[str, ActiveModel], config: UpdaterConfig
) -> dict[str, LoadedModel]:
    """Load every ACTIVE model named by the published registry.

    When ``require_expected_models`` is set the loaded versions are checked
    against the four this worker was built for. A mismatch stops the run: a
    model that was promoted without the worker being reviewed is exactly the
    situation where silently scoring anyway would be wrong.
    """
    loaded: dict[str, LoadedModel] = {}
    manifest = load_manifest()

    for pathogen, meta in sorted(registry.items()):
        # The registry says which version is in service; the manifest says which
        # bytes that version is. Both must agree before anything is unpickled.
        entry = manifest_entry(manifest, pathogen, meta.model_version)
        artifact = resolve_artifact(meta, config.models_dir)
        verify_artifact(artifact, entry)
        verify_libraries(entry)
        try:
            bundle = joblib.load(artifact)
        except Exception as exc:  # noqa: BLE001 - any unpickling failure is corruption
            raise ModelIntegrityError(
                f"{meta.model_version}: {artifact.name} could not be loaded ({type(exc).__name__})"
            ) from exc
        verify_bundle(bundle, entry, pathogen)

        estimator = bundle["model"]
        n_features = int(bundle["n_features"])

        loaded[pathogen] = LoadedModel(
            meta=meta, estimator=estimator, n_features=n_features, artifact=artifact
        )
        log.info(
            "[AMR UPDATE] loaded %s for %s (%d features) from %s, sha256 %s verified",
            meta.model_version, pathogen, n_features, artifact.name, entry["sha256"][:16],
        )

    if config.require_expected_models:
        verify_expected(loaded)

    return loaded


def verify_expected(loaded: dict[str, LoadedModel]) -> None:
    """Check the loaded set against the four production models."""
    actual = {p: m.meta.model_version for p, m in loaded.items()}
    missing = [p for p in EXPECTED_ACTIVE_MODELS if p not in actual]
    changed = {
        p: (EXPECTED_ACTIVE_MODELS[p], actual[p])
        for p in EXPECTED_ACTIVE_MODELS
        if p in actual and actual[p] != EXPECTED_ACTIVE_MODELS[p]
    }

    if missing or changed:
        parts = []
        if missing:
            parts.append(f"no ACTIVE model for {', '.join(missing)}")
        for pathogen, (expected, found) in changed.items():
            parts.append(f"{pathogen}: expected {expected}, registry says {found}")
        raise ModelIntegrityError(
            "the published registry does not match the models this worker was built for — "
            + "; ".join(parts)
            + ". Rebuild the image with the new artifacts, or set "
            "AMR_REQUIRE_EXPECTED_MODELS=0 once you have checked the change is intended."
        )

    log.info("[AMR UPDATE] model check passed: %s", ", ".join(sorted(actual.values())))
