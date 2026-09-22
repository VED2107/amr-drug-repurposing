"""Diagnose the runtime environment.

Reports what is installed, what is reachable and what is missing, so a failure
is traced to its cause instead of surfacing halfway through a pipeline run.

    python scripts/check_environment.py
    python scripts/check_environment.py --skip-network
"""

from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

OK = "  ok   "
WARN = " warn  "
FAIL = " fail  "


def _line(status: str, label: str, detail: str = "") -> None:
    print(f"[{status}] {label:<34} {detail}")


def check_python() -> bool:
    version = platform.python_version()
    ok = sys.version_info >= (3, 11)
    _line(OK if ok else FAIL, "Python", f"{version} ({platform.platform()})")
    return ok


def check_packages() -> bool:
    required = ["rdkit", "pandas", "numpy", "scipy", "sklearn", "joblib",
                "streamlit", "plotly", "requests", "yaml"]
    optional = {"meeko": "ligand preparation", "gemmi": "receptor preparation",
                "py3Dmol": "3D pose viewer", "xgboost": "optional model",
                "lightgbm": "optional model", "pytest": "test suite"}
    ok = True

    for name in required:
        try:
            module = __import__(name)
            _line(OK, name, getattr(module, "__version__", ""))
        except ImportError:
            _line(FAIL, name, "missing - pip install -e .")
            ok = False

    for name, purpose in optional.items():
        try:
            module = __import__(name)
            _line(OK, name, f"{getattr(module, '__version__', '')}  ({purpose})")
        except ImportError:
            _line(WARN, name, f"missing - {purpose} unavailable")
    return ok


def check_config() -> bool:
    try:
        from src.config import load_config

        cfg = load_config()
        _line(OK, "configuration", str(cfg.path.relative_to(PROJECT_ROOT)))
        _line(OK, "  pathogens", ", ".join(p.label for p in cfg.pathogens))
        _line(OK, "  fingerprint",
              f"{cfg.get('chemistry','fingerprint','n_bits')}-bit Morgan, "
              f"radius {cfg.get('chemistry','fingerprint','radius')}")
        _line(OK, "  database", str(cfg.db_path))
        return True
    except Exception as exc:
        _line(FAIL, "configuration", f"{type(exc).__name__}: {exc}")
        return False


def check_database() -> bool:
    from src.config import load_config
    from src.db import connect

    cfg = load_config()
    if not cfg.db_path.exists():
        _line(WARN, "database", "not created yet - run python -m src.pipeline.run")
        return True
    conn = connect(cfg)
    try:
        for table in ("molecules", "bioactivity", "drugs", "predictions",
                      "docking_results", "clinical_trials", "model_versions"):
            try:
                n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                _line(OK, f"  {table}", f"{n:,} rows")
            except Exception:
                _line(WARN, f"  {table}", "table not present")
        active = conn.execute(
            "SELECT pathogen_key, model_version FROM model_versions WHERE status='ACTIVE'"
        ).fetchall()
        _line(OK if active else WARN, "  active models",
              ", ".join(f"{r[0]}={r[1]}" for r in active) or "none trained yet")
        return True
    finally:
        conn.close()


def check_vina() -> bool:
    from src.config import load_config
    from src.docking.vina_runner import vina_version

    cfg = load_config()
    binary = cfg.resolve_vina_binary()
    if binary is None:
        _line(WARN, "AutoDock Vina",
              "not found - docking will be skipped, other stages unaffected")
        return True
    _line(OK, "AutoDock Vina", f"{vina_version(binary)}  ({binary})")
    return True


def check_meeko_cli() -> bool:
    scripts = Path(sys.executable).parent
    found = [n for n in ("mk_prepare_receptor.exe", "mk_prepare_receptor")
             if (scripts / n).exists()]
    if found:
        _line(OK, "mk_prepare_receptor", str(scripts / found[0]))
    else:
        _line(WARN, "mk_prepare_receptor", "missing - receptor preparation unavailable")
    return True


def check_network() -> bool:
    from src.config import load_config
    from src.ingestion.http import HttpClient

    cfg = load_config()
    if cfg.offline:
        _line(WARN, "network", "AMR_OFFLINE=1 - all outbound calls are blocked")
        return True

    endpoints = {
        "ChEMBL": (f"{cfg.get('ingestion','chembl','base_url')}/status.json", None),
        "ClinicalTrials.gov": (cfg.get("ingestion", "clinicaltrials", "base_url"),
                               {"pageSize": 1}),
        "RCSB PDB": ("https://files.rcsb.org/download/1RX2.pdb", None),
    }
    client = HttpClient(cfg)
    ok = True
    try:
        for name, (url, params) in endpoints.items():
            try:
                response = client.get(url, params=params)
                _line(OK, name, f"HTTP {response.status_code}")
            except Exception as exc:
                _line(WARN, name, f"unreachable: {type(exc).__name__}")
                ok = False
        try:
            response = client.get(
                cfg.get("ingestion", "orange_book", "zip_url"),
                user_agent=cfg.get("ingestion", "orange_book", "user_agent"),
            )
            is_zip = response.content[:2] == b"PK"
            _line(OK if is_zip else WARN, "FDA Orange Book",
                  f"HTTP {response.status_code}, {len(response.content):,} bytes"
                  + ("" if is_zip else " (not a zip - openFDA fallback will be used)"))
        except Exception as exc:
            _line(WARN, "FDA Orange Book", f"unreachable: {type(exc).__name__}")
    finally:
        client.close()
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the AMR runtime environment")
    parser.add_argument("--skip-network", action="store_true")
    args = parser.parse_args(argv)

    print("\nAMR Drug Repurposing - environment check\n" + "=" * 62)

    checks = [
        ("Runtime", check_python),
        ("Packages", check_packages),
        ("Configuration", check_config),
        ("Database", check_database),
        ("Docking", check_vina),
        ("Meeko", check_meeko_cli),
    ]
    if not args.skip_network:
        checks.append(("Network", check_network))

    failures = 0
    for title, check in checks:
        print(f"\n{title}\n" + "-" * 62)
        try:
            if not check():
                failures += 1
        except Exception as exc:
            _line(FAIL, title, f"{type(exc).__name__}: {exc}")
            failures += 1

    print("\n" + "=" * 62)
    if failures:
        print(f"{failures} check(s) reported a problem. See the lines marked fail above.\n")
        return 1
    print("Environment is ready.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
