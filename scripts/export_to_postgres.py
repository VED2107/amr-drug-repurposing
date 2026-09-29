"""Export the research SQLite database into the production Postgres schema.

This is a copy, not a transformation. Every scientific value crosses unchanged:
no rounding, no defaulting, no coercion of NULL to zero. The only things the
exporter does are

  * rename nothing,
  * drop two columns that exist only for the pipeline (``is_demo`` and the
    fingerprint BLOB), and
  * refuse to run at all if demo rows are present.

The last point matters. ``is_demo`` marks rows produced by ``build_demo.py`` for
screenshots. Those are synthetic and must never reach a production database, so
rather than filtering them out silently the exporter stops and says so.

Usage::

    # write CSVs plus a \\copy script, no database needed
    python -m scripts.export_to_postgres --out build/pg

    # load straight into Supabase (service role connection string)
    python -m scripts.export_to_postgres --database-url "$SUPABASE_DB_URL"

    # replace only some tables, leaving every other table as it is
    python -m scripts.export_to_postgres --database-url "$SUPABASE_DB_URL" \
        --tables medicine_classes medicine_indications medicine_use_status

The connection string is read from the environment or the command line and is
never written to disk by this script.
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys
from pathlib import Path
from typing import Iterator, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE = REPO_ROOT / "data" / "amr.sqlite"

#: Load order respects foreign keys.
TABLES: tuple[str, ...] = (
    "pathogens",
    "targets",
    "molecules",
    "drugs",
    "bioactivity",
    "dataset_versions",
    "dataset_members",
    "model_versions",
    "model_benchmarks",
    "predictions",
    "docking_runs",
    "docking_results",
    "clinical_queries",
    "clinical_trials",
    "medicine_classes",
    "medicine_indications",
    "medicine_use_status",
    "pipeline_runs",
    "pipeline_errors",
    "data_sources",
    "schema_info",
)

#: Columns dropped on the way across, wherever they appear, with the reason.
#:
#: ``is_demo``    pipeline bookkeeping. The production schema has no demo
#:                concept because demo rows are refused outright
#:                (see :func:`assert_no_demo_rows`).
#: ``fingerprint`` a model input blob, never displayed, and large.
#:
#: This is deliberately a global rule rather than a per-table list: a per-table
#: list silently goes stale the moment a column is added upstream, and the
#: failure mode is a confusing COPY error rather than an obvious one.
DROPPED_EVERYWHERE: frozenset[str] = frozenset({"is_demo", "fingerprint"})

#: SQLite stores these as 0/1; Postgres wants real booleans.
BOOLEAN_COLUMNS: dict[str, frozenset[str]] = {
    "molecules": frozenset({"is_valid"}),
    "bioactivity": frozenset({"strain_specific"}),
    "model_versions": frozenset({"is_baseline"}),
    "model_benchmarks": frozenset({"is_baseline", "selected"}),
    "clinical_trials": frozenset({"amr_related"}),
}


class DemoDataPresent(RuntimeError):
    """Raised when the source database still contains synthetic demo rows."""


def source_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    if not rows:
        raise RuntimeError(f"table {table!r} does not exist in the source database")
    return [r[1] for r in rows if r[1] not in DROPPED_EVERYWHERE]


def assert_no_demo_rows(conn: sqlite3.Connection) -> None:
    """Refuse to export a database that carries demo data.

    Filtering demo rows out quietly would mean the exporter's output depended on
    a flag nobody looked at. Failing loudly keeps the decision with a person.
    """
    offenders: list[str] = []
    for table in TABLES:
        cols = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
        if "is_demo" not in cols:
            continue
        n = conn.execute(f'SELECT COUNT(*) FROM "{table}" WHERE is_demo = 1').fetchone()[0]
        if n:
            offenders.append(f"{table}: {n} demo row(s)")
    if offenders:
        raise DemoDataPresent(
            "refusing to export: the source database contains demo rows.\n  "
            + "\n  ".join(offenders)
            + "\nRebuild the database from the real pipeline before exporting."
        )


def convert(table: str, column: str, value: object) -> object:
    """Convert one SQLite value for Postgres.

    NULL stays NULL. Integers that are really booleans become booleans. Nothing
    else is touched — in particular no numeric value is rounded or reformatted.
    """
    if value is None:
        return None
    if column in BOOLEAN_COLUMNS.get(table, frozenset()):
        return bool(value)
    return value


def iter_rows(
    conn: sqlite3.Connection, table: str, columns: Sequence[str]
) -> Iterator[tuple[object, ...]]:
    quoted = ", ".join(f'"{c}"' for c in columns)
    cursor = conn.execute(f'SELECT {quoted} FROM "{table}"')
    while True:
        batch = cursor.fetchmany(5_000)
        if not batch:
            return
        for row in batch:
            yield tuple(convert(table, col, val) for col, val in zip(columns, row))


def write_csvs(conn: sqlite3.Connection, out_dir: Path) -> dict[str, int]:
    """Write one CSV per table plus a psql \\copy script."""
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    copy_lines: list[str] = [
        "-- Generated by scripts/export_to_postgres.py",
        "-- Run with: psql \"$SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f load.sql",
        "begin;",
    ]

    for table in TABLES:
        columns = source_columns(conn, table)
        path = out_dir / f"{table}.csv"
        n = 0
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(columns)
            for row in iter_rows(conn, table, columns):
                writer.writerow(["" if v is None else v for v in row])
                n += 1
        counts[table] = n
        quoted = ", ".join(f'"{c}"' for c in columns)
        copy_lines.append(
            f"\\copy amr.{table} ({quoted}) from '{table}.csv' "
            "with (format csv, header true, null '')"
        )

    copy_lines.append("commit;")
    (out_dir / "load.sql").write_text("\n".join(copy_lines) + "\n", encoding="utf-8")
    return counts


def load_direct(
    conn: sqlite3.Connection, database_url: str, tables: Sequence[str] = TABLES
) -> dict[str, int]:
    """Load straight into Postgres over a connection string.

    ``tables`` limits the load to those tables. They are truncated without
    ``cascade``, so a partial load that would empty a table another one depends
    on fails instead of silently wiping it.
    """
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise SystemExit(
            "psycopg is required for --database-url. Install it with:\n"
            "  python -m pip install 'psycopg[binary]'\n"
            "Or export CSVs instead with --out build/pg"
        ) from exc

    counts: dict[str, int] = {}
    with psycopg.connect(database_url) as pg:
        with pg.cursor() as cur:
            partial = tuple(tables) != TABLES
            # Truncate in reverse dependency order so a re-run is idempotent.
            for table in reversed(tables):
                cur.execute(f"truncate table amr.{table}{'' if partial else ' cascade'}")
            for table in tables:
                columns = source_columns(conn, table)
                quoted = ", ".join(f'"{c}"' for c in columns)
                placeholders = ", ".join(["%s"] * len(columns))
                n = 0
                with cur.copy(
                    f"copy amr.{table} ({quoted}) from stdin"
                ) as copy:
                    for row in iter_rows(conn, table, columns):
                        copy.write_row(row)
                        n += 1
                counts[table] = n
                del placeholders
        pg.commit()
    return counts


def verify(conn: sqlite3.Connection, counts: dict[str, int]) -> list[str]:
    """Check that every source row was accounted for."""
    problems: list[str] = []
    for table, exported in counts.items():
        expected = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        if exported != expected:
            problems.append(f"{table}: exported {exported}, source has {expected}")
    return problems


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--out", type=Path, help="directory for CSV + load.sql")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("SUPABASE_DB_URL"),
        help="Postgres connection string (defaults to $SUPABASE_DB_URL)",
    )
    parser.add_argument(
        "--tables",
        nargs="+",
        choices=TABLES,
        help="load only these tables (with --database-url); the others are left untouched",
    )
    parser.add_argument(
        "--allow-demo",
        action="store_true",
        help="export even if demo rows are present (never use for production)",
    )
    args = parser.parse_args(argv)

    if not args.out and not args.database_url:
        parser.error("give --out for CSVs, or --database-url to load directly")

    if not args.sqlite.exists():
        parser.error(f"source database not found: {args.sqlite}")

    conn = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True)
    try:
        if not args.allow_demo:
            assert_no_demo_rows(conn)

        tables = tuple(t for t in TABLES if t in (args.tables or TABLES))
        counts = (
            load_direct(conn, args.database_url, tables)
            if args.database_url
            else write_csvs(conn, args.out)
        )

        problems = verify(conn, counts)
        width = max(len(t) for t in counts)
        for table, n in counts.items():
            print(f"  {table:<{width}}  {n:>7,}")
        print(f"  {'':<{width}}  {sum(counts.values()):>7,} rows total")

        if problems:
            print("\nROW COUNT MISMATCH:", file=sys.stderr)
            for p in problems:
                print(f"  {p}", file=sys.stderr)
            return 1

        destination = args.database_url and "Postgres" or str(args.out)
        print(f"\nAll row counts match the source. Destination: {destination}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
