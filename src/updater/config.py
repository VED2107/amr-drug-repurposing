"""Configuration for the update worker, entirely from the environment.

A container carries no project file and no developer's paths, so everything the
worker needs is read from environment variables and validated up front. A run
that cannot possibly succeed — no database, no models — says so before it
contacts a single external source.

Nothing here is ever logged. The connection string and the service key are read,
held, and passed to the client that needs them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..logging_utils import get_logger

log = get_logger("amr.updater")

#: The only pathogens this system has models for. A prediction is never
#: produced for anything outside this set, whatever a source may claim.
SUPPORTED_PATHOGENS: tuple[str, ...] = ("mrsa", "ecoli", "kpneumoniae", "mtb")

#: The production models, named explicitly. The worker checks that what it
#: loaded is what it expected, so a silently swapped ACTIVE model is caught
#: rather than used.
EXPECTED_ACTIVE_MODELS: dict[str, str] = {
    "mrsa": "RF-mrsa-v4",
    "ecoli": "RF-ecoli-v4",
    "kpneumoniae": "RF-kpneumoniae-v5",
    "mtb": "RF-mtb-v5",
}


class ConfigurationError(RuntimeError):
    """Raised when the worker is not configured well enough to run."""


@dataclass(frozen=True)
class UpdaterConfig:
    """Everything the worker needs, resolved once."""

    #: Postgres connection string for Supabase. Never logged.
    database_url: str
    #: Directory holding the model artifacts inside the container.
    models_dir: Path
    #: Upper bound on medicines processed in one run; keeps a first run bounded.
    max_new_medicines: int
    #: Stop before writing anything, and report what would have been written.
    dry_run: bool
    #: Refuse to run if the ACTIVE models are not the expected four.
    require_expected_models: bool
    #: Contact address sent to public APIs, as their terms of use ask.
    contact_email: str
    #: Skip the source fetch entirely; used by tests and offline checks.
    offline: bool

    def describe(self) -> str:
        """A one-line summary that deliberately contains no secret."""
        host = "configured" if self.database_url else "missing"
        return (
            f"database={host} models_dir={self.models_dir} "
            f"max_new={self.max_new_medicines} dry_run={self.dry_run}"
        )


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a whole number, got {raw!r}") from exc
    if value <= 0:
        raise ConfigurationError(f"{name} must be greater than zero, got {value}")
    return value


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def load_updater_config() -> UpdaterConfig:
    """Read and validate the environment.

    Raises :class:`ConfigurationError` with the name of what is missing, rather
    than failing later with a connection error that hides the real cause.
    """
    database_url = (
        os.environ.get("AMR_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("SUPABASE_DB_URL")
        or ""
    ).strip()

    if not database_url:
        raise ConfigurationError(
            "no database connection string. Set AMR_DATABASE_URL (or DATABASE_URL) "
            "to the Supabase Postgres connection string."
        )

    models_dir = Path(os.environ.get("AMR_MODELS_DIR", "/app/models")).expanduser()
    if not models_dir.exists():
        raise ConfigurationError(
            f"models directory {models_dir} does not exist. Bake the artifacts into the "
            "image or mount them, and set AMR_MODELS_DIR if they live elsewhere."
        )

    config = UpdaterConfig(
        database_url=database_url,
        models_dir=models_dir,
        max_new_medicines=_env_int("AMR_MAX_NEW_MEDICINES", 500),
        dry_run=_env_flag("AMR_DRY_RUN"),
        require_expected_models=_env_flag("AMR_REQUIRE_EXPECTED_MODELS", True),
        contact_email=os.environ.get("AMR_CONTACT_EMAIL", "").strip(),
        offline=_env_flag("AMR_OFFLINE"),
    )

    log.info("[AMR UPDATE] configuration: %s", config.describe())
    return config
