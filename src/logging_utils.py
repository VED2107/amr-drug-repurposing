"""Logging setup shared by every pipeline stage."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_CONFIGURED = False


def setup_logging(log_dir: Path | None = None, level: int = logging.INFO,
                  name: str = "amr") -> logging.Logger:
    """Configure root logging once; return the project logger.

    Console output stays readable; the file handler keeps the full record so a
    pipeline run can be audited after the fact.
    """
    global _CONFIGURED
    logger = logging.getLogger(name)
    if _CONFIGURED:
        return logger

    logger.setLevel(level)
    logger.propagate = False

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%H:%M:%S"))
    logger.addHandler(console)

    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_dir / "pipeline.log", encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(
            logging.Formatter("%(asctime)s  %(levelname)-7s %(name)s  %(message)s")
        )
        logger.addHandler(fh)

    # RDKit is extremely chatty about sanitisation failures, which we handle
    # and count ourselves.
    try:
        from rdkit import RDLogger

        RDLogger.DisableLog("rdApp.*")
    except Exception:  # pragma: no cover - rdkit always present in practice
        pass

    _CONFIGURED = True
    return logger


def get_logger(name: str = "amr") -> logging.Logger:
    return logging.getLogger(name)
