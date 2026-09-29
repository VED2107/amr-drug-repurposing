"""Copy predictions the update worker published back into the research database.

The worker scores medicines inside Docker and writes to the production schema
only. After it runs, this brings those prediction rows into ``data/amr.sqlite``
so the research database and the published one hold the same predictions.

Only rows that are missing locally are inserted; nothing local is changed or
deleted, and no value is recomputed here.

    python -m scripts.sync_predictions_from_postgres --database-url "$AMR_DATABASE_URL"
"""

from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
COLUMNS = (
    "molecule_id", "pathogen_key", "probability", "model_version", "model_type",
    "dataset_version", "feature_version", "predicted_at",
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, default=REPO_ROOT / "data" / "amr.sqlite")
    parser.add_argument("--database-url", default=os.environ.get("AMR_DATABASE_URL"))
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("give --database-url or set AMR_DATABASE_URL")

    import psycopg

    local = sqlite3.connect(args.sqlite)
    have = {
        (m, p, v) for m, p, v in local.execute(
            "SELECT molecule_id, pathogen_key, model_version FROM predictions"
        )
    }
    local_cols = [r[1] for r in local.execute("PRAGMA table_info(predictions)")]
    with psycopg.connect(args.database_url, options="-c search_path=amr,public",
                         prepare_threshold=None, connect_timeout=30) as pg:
        rows = pg.execute(
            f"""SELECT {', '.join(COLUMNS)} FROM predictions p
                 WHERE p.model_version IN (SELECT model_version FROM model_versions
                                            WHERE status = 'ACTIVE')"""
        ).fetchall()
    new = [r for r in rows if (r[0], r[1], r[3]) not in have]
    cols = [c for c in COLUMNS if c in local_cols]
    extra = {"is_demo": 0} if "is_demo" in local_cols else {}
    names = cols + list(extra)
    local.executemany(
        f"INSERT INTO predictions({', '.join(names)}) VALUES({', '.join('?' * len(names))})",
        [tuple(str(v) if k == "predicted_at" else v for k, v in zip(COLUMNS, r) if k in cols)
         + tuple(extra.values()) for r in new],
    )
    local.commit()
    print(f"published ACTIVE predictions: {len(rows)}; copied {len(new)} missing rows into {args.sqlite}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
