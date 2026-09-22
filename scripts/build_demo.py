"""Build the deterministic demo database.

Demo mode exists so the dashboard can be inspected with no network access and
no pipeline run. It contains REAL data - a deterministic subset of a completed
run - and every row it copies is flagged ``is_demo = 1`` so the dashboard can
label it. Nothing here fabricates a prediction, a docking score or a clinical
record.

    python scripts/build_demo.py                     # from the default database
    python scripts/build_demo.py --source data/amr.sqlite --limit 150
    AMR_DB_PATH=data/demo/amr_demo.sqlite streamlit run app/streamlit_app.py
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.config import load_config  # noqa: E402
from src.db import init_db, set_setting, utcnow  # noqa: E402
from src.logging_utils import get_logger, setup_logging  # noqa: E402

log = get_logger("amr.demo")


def build_demo(source: Path, target: Path, *, limit: int, seed_pathogens: list[str]) -> dict[str, int]:
    """Copy a deterministic slice of a real database into the demo database."""
    if not source.exists():
        raise FileNotFoundError(
            f"source database not found: {source}. Run the pipeline first: "
            "python -m src.pipeline.run"
        )

    cfg = load_config()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()

    dest = sqlite3.connect(str(target))
    dest.row_factory = sqlite3.Row
    init_db(dest, cfg)

    src = sqlite3.connect(str(source))
    src.row_factory = sqlite3.Row

    counts: dict[str, int] = {}

    # Deterministic selection: the highest-probability predictions per pathogen,
    # ordered by molecule id so repeated builds produce identical content.
    molecule_ids: list[str] = []
    for pathogen in seed_pathogens:
        rows = src.execute(
            """SELECT DISTINCT molecule_id FROM predictions
               WHERE pathogen_key = ?
               ORDER BY probability DESC, molecule_id ASC LIMIT ?""",
            (pathogen, limit),
        ).fetchall()
        molecule_ids.extend(r["molecule_id"] for r in rows)
    molecule_ids = sorted(set(molecule_ids))

    if not molecule_ids:
        # No predictions yet: fall back to valid molecules so the demo still has
        # chemistry to show.
        molecule_ids = [
            r["molecule_id"]
            for r in src.execute(
                "SELECT molecule_id FROM molecules WHERE is_valid = 1 "
                "ORDER BY molecule_id LIMIT ?",
                (limit,),
            ).fetchall()
        ]

    placeholders = ",".join("?" for _ in molecule_ids)

    def copy(table: str, sql: str, params: tuple = ()) -> int:
        rows = src.execute(sql, params).fetchall()
        if not rows:
            counts[table] = 0
            return 0
        columns = rows[0].keys()
        marks = ",".join("?" for _ in columns)
        dest.executemany(
            f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) VALUES ({marks})",
            [tuple(row[c] for c in columns) for row in rows],
        )
        counts[table] = len(rows)
        return len(rows)

    copy("molecules", f"SELECT * FROM molecules WHERE molecule_id IN ({placeholders})",
         tuple(molecule_ids))
    copy("drugs", f"SELECT * FROM drugs WHERE molecule_id IN ({placeholders})", tuple(molecule_ids))
    copy("bioactivity", f"SELECT * FROM bioactivity WHERE molecule_id IN ({placeholders})",
         tuple(molecule_ids))
    copy("model_versions", "SELECT * FROM model_versions")
    copy("model_benchmarks", "SELECT * FROM model_benchmarks")
    copy("dataset_versions", "SELECT * FROM dataset_versions")
    copy("dataset_members",
         f"SELECT * FROM dataset_members WHERE molecule_id IN ({placeholders})", tuple(molecule_ids))
    copy("predictions", f"SELECT * FROM predictions WHERE molecule_id IN ({placeholders})",
         tuple(molecule_ids))
    copy("targets", "SELECT * FROM targets")
    copy("docking_runs", "SELECT * FROM docking_runs")
    copy("docking_results",
         f"SELECT * FROM docking_results WHERE molecule_id IN ({placeholders})", tuple(molecule_ids))
    copy("clinical_trials",
         f"SELECT * FROM clinical_trials WHERE molecule_id IN ({placeholders})", tuple(molecule_ids))
    copy("clinical_queries",
         f"SELECT * FROM clinical_queries WHERE molecule_id IN ({placeholders})", tuple(molecule_ids))
    copy("pipeline_runs", "SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 50")
    copy("data_sources", "SELECT * FROM data_sources")

    # Flag every copied row that can be labelled, so the dashboard shows the
    # DEMO DATA banner and no demo row can be mistaken for a fresh result.
    for table in ("molecules", "drugs", "bioactivity", "predictions",
                  "clinical_trials", "pipeline_runs", "data_sources"):
        dest.execute(f"UPDATE {table} SET is_demo = 1")

    set_setting(dest, "demo_mode", "true")
    set_setting(dest, "demo_built_at", utcnow())
    set_setting(dest, "demo_source", str(source))
    active = src.execute("SELECT value FROM settings WHERE key='active_dataset_version'").fetchone()
    if active:
        set_setting(dest, "active_dataset_version", active["value"])

    dest.commit()
    dest.close()
    src.close()

    counts["selected_molecules"] = len(molecule_ids)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the deterministic demo database")
    parser.add_argument("--source", type=Path, default=None, help="source database")
    parser.add_argument("--target", type=Path, default=None, help="demo database to write")
    parser.add_argument("--limit", type=int, default=100, help="molecules per pathogen")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))

    source = args.source or cfg.db_path
    target = args.target or (cfg.path_for("data_demo") / "amr_demo.sqlite")

    counts = build_demo(
        source, target, limit=args.limit,
        seed_pathogens=[p.key for p in cfg.pathogens],
    )

    log.info("demo database written to %s", target)
    for table, n in sorted(counts.items()):
        log.info("  %-20s %d", table, n)
    print(f"\nRun the dashboard against it with:\n"
          f"  AMR_DB_PATH={target} streamlit run app/streamlit_app.py\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
