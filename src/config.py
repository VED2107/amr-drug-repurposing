"""Configuration loading and path resolution.

The whole pipeline reads its scientific thresholds from ``configs/config.yaml``
so that a run can be reproduced from the config file alone.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "configs" / "config.yaml"

load_dotenv(PROJECT_ROOT / ".env", override=False)


class ConfigError(RuntimeError):
    """Raised when the configuration file is missing or structurally invalid."""


@dataclass(frozen=True)
class Pathogen:
    """One of the four target pathogens named by the project presentation."""

    key: str
    label: str
    full_name: str
    organism: str
    tax_id: int
    resistance_markers: tuple[str, ...]

    def is_resistant_strain_assay(self, assay_description: str | None) -> bool:
        """True when the assay text explicitly names a resistant strain.

        Used only to *flag* records, never to filter them: a susceptible-strain
        MIC is still a legitimate training measurement.
        """
        if not assay_description:
            return False
        text = assay_description.lower()
        return any(marker in text for marker in self.resistance_markers)


class Config:
    """Thin typed wrapper over the YAML configuration tree."""

    def __init__(self, data: dict[str, Any], path: Path):
        self._data = data
        self.path = path
        self._validate()

    # -- access ---------------------------------------------------------
    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def get(self, *keys: str, default: Any = None) -> Any:
        """Nested lookup: ``cfg.get("ml", "split", "method")``."""
        node: Any = self._data
        for key in keys:
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return node

    @property
    def raw(self) -> dict[str, Any]:
        return self._data

    # -- validation -----------------------------------------------------
    def _validate(self) -> None:
        required = ["project", "paths", "ingestion", "pathogens", "labeling",
                    "chemistry", "ml", "screening", "docking"]
        missing = [k for k in required if k not in self._data]
        if missing:
            raise ConfigError(f"config {self.path} missing sections: {missing}")

        n_bits = self.get("chemistry", "fingerprint", "n_bits")
        if n_bits != 1024:
            raise ConfigError(
                f"fingerprint n_bits is {n_bits}; the project specifies 1024-bit "
                "Morgan fingerprints. Change it deliberately or not at all."
            )
        active = self.get("labeling", "active_threshold_pactivity")
        inactive = self.get("labeling", "inactive_threshold_pactivity")
        if active is None or inactive is None or active <= inactive:
            raise ConfigError(
                "labeling.active_threshold_pactivity must be greater than "
                "labeling.inactive_threshold_pactivity"
            )

    # -- derived --------------------------------------------------------
    @property
    def seed(self) -> int:
        return int(self.get("project", "random_seed", default=42))

    @property
    def pathogens(self) -> list[Pathogen]:
        out = []
        for entry in self._data["pathogens"]:
            out.append(
                Pathogen(
                    key=entry["key"],
                    label=entry["label"],
                    full_name=entry["full_name"],
                    organism=entry["organism"],
                    tax_id=int(entry["tax_id"]),
                    resistance_markers=tuple(entry.get("resistance_markers", [])),
                )
            )
        return out

    def pathogen(self, key: str) -> Pathogen:
        for p in self.pathogens:
            if p.key == key:
                return p
        raise KeyError(f"unknown pathogen key: {key}")

    # -- paths ----------------------------------------------------------
    def path_for(self, name: str) -> Path:
        """Resolve a configured path to an absolute path under the project."""
        raw = self.get("paths", name)
        if raw is None:
            raise ConfigError(f"paths.{name} is not configured")
        p = Path(raw)
        return p if p.is_absolute() else (PROJECT_ROOT / p)

    @property
    def db_path(self) -> Path:
        override = os.environ.get("AMR_DB_PATH")
        if override:
            return Path(override)
        return self.path_for("database")

    def ensure_directories(self) -> None:
        for name in ("data_raw", "data_processed", "data_external", "models", "logs"):
            self.path_for(name).mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    # -- runtime toggles ------------------------------------------------
    @property
    def offline(self) -> bool:
        return os.environ.get("AMR_OFFLINE", "0").strip() in {"1", "true", "yes"}

    @property
    def user_agent(self) -> str:
        base = self.get("network", "user_agent", default="amr-drug-repurposing/1.0")
        email = os.environ.get("AMR_CONTACT_EMAIL", "").strip()
        return f"{base} ({email})" if email else base

    def resolve_vina_binary(self) -> Path | None:
        """Locate the Vina executable, or None when docking is unavailable.

        Order: ``AMR_VINA_BIN`` env var, the configured path, then ``vina`` on
        PATH. Returning None is a legitimate outcome and is recorded as a
        pipeline limitation rather than treated as a crash.
        """
        env = os.environ.get("AMR_VINA_BIN", "").strip()
        if env and Path(env).exists():
            return Path(env)
        configured = self.get("docking", "vina_binary")
        if configured:
            p = Path(configured)
            if not p.is_absolute():
                p = PROJECT_ROOT / p
            if p.exists():
                return p
        found = shutil.which("vina") or shutil.which("vina.exe")
        return Path(found) if found else None


@lru_cache(maxsize=4)
def load_config(path: str | os.PathLike[str] | None = None) -> Config:
    """Load and cache the project configuration."""
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not cfg_path.exists():
        raise ConfigError(f"configuration file not found: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ConfigError(f"configuration file {cfg_path} did not parse to a mapping")
    return Config(data, cfg_path)
