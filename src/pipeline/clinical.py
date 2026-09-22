"""Stage 6 - retrospective clinical evidence from ClinicalTrials.gov.

A drug that returns no studies is still recorded in ``clinical_queries`` so the
dashboard can distinguish "no trials found" from "never looked".

The stage is resumable: a medicine already recorded in ``clinical_queries`` is
skipped unless ``--refresh`` (re-query everything) or ``--retry-failed``
(re-query only the ones whose last attempt failed) is given. Interrupting the
process loses at most the medicine in flight, because each lookup is committed
before the next one starts.

Usage:
    python -m src.pipeline.clinical                     # shortlist, 50 medicines
    python -m src.pipeline.clinical --all --limit 5000  # whole approved library
    python -m src.pipeline.clinical --retry-failed
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import time

from ..clinical import ClinicalTrialsClient
from ..config import Config, load_config
from ..db import init_db, record_source, session, utcnow
from ..ingestion.http import NetworkDisabledError
from ..logging_utils import get_logger, setup_logging
from .runlog import STATUS_SKIPPED, PipelineRun, stage_run

log = get_logger("amr.pipeline.clinical")

#: Pause between ClinicalTrials.gov requests. The public v2 API publishes no
#: hard rate limit; this keeps a full-library sweep to roughly one request per
#: second, which is well inside what the service tolerates.
DEFAULT_REQUEST_DELAY = 0.35


def query_term_for(name: str) -> str:
    """Turn an Orange Book ingredient string into a registry search term.

    Orange Book names combination products as ``"TRISULFAPYRIMIDINES
    (SULFADIAZINE; SULFAMERAZINE)"``. Taking the text before the first semicolon
    leaves an unbalanced bracket, which ClinicalTrials.gov rejects with HTTP 400,
    so brackets are removed before the split rather than after it.
    """
    cleaned = re.sub(r"\([^)]*\)", " ", name or "")
    cleaned = cleaned.split(";")[0]
    cleaned = cleaned.replace("(", " ").replace(")", " ")
    cleaned = re.sub(r"[\"']", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.-")
    if not cleaned:
        # Everything was bracketed; fall back to the raw name with the brackets
        # stripped so the medicine is still searched rather than skipped.
        cleaned = re.sub(r"[()]", " ", (name or "").split(";")[0])
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.-")
    return cleaned


def candidates_to_query(
    conn: sqlite3.Connection,
    cfg: Config,
    *,
    limit: int,
    refresh: bool,
    min_probability: float | None = None,
    retry_failed: bool = False,
) -> list[sqlite3.Row]:
    """Medicines that still need a clinical lookup, best prediction first.

    ``min_probability`` of 0.0 covers the entire scored approved library;
    leaving it unset falls back to the screening shortlist threshold.
    """
    threshold = (
        float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
        if min_probability is None
        else float(min_probability)
    )
    if refresh:
        not_queried = ""
    elif retry_failed:
        not_queried = (
            "AND NOT EXISTS (SELECT 1 FROM clinical_queries q "
            "WHERE q.molecule_id = p.molecule_id AND q.status = 'ok')"
        )
    else:
        not_queried = (
            "AND NOT EXISTS (SELECT 1 FROM clinical_queries q WHERE q.molecule_id = p.molecule_id)"
        )
    return conn.execute(
        f"""
        SELECT p.molecule_id,
               MAX(p.probability) AS best_probability,
               COALESCE(MIN(d.generic_name), m.pref_name) AS query_name
        FROM predictions p
        JOIN molecules m ON m.molecule_id = p.molecule_id
        LEFT JOIN drugs d ON d.molecule_id = p.molecule_id
        WHERE p.probability >= ?
          {not_queried}
        GROUP BY p.molecule_id
        HAVING query_name IS NOT NULL AND TRIM(query_name) <> ''
        ORDER BY best_probability DESC
        LIMIT ?
        """,
        (threshold, limit),
    ).fetchall()


def coverage_snapshot(conn: sqlite3.Connection) -> dict[str, int]:
    """Live counts for the coverage report. Every number is read, never assumed."""
    row = conn.execute(
        """
        SELECT
          (SELECT COUNT(DISTINCT molecule_id) FROM drugs WHERE molecule_id IS NOT NULL)
            AS medicines_total,
          (SELECT COUNT(*) FROM clinical_queries) AS medicines_queried,
          (SELECT COUNT(*) FROM clinical_queries WHERE status = 'ok') AS medicines_ok,
          (SELECT COUNT(*) FROM clinical_queries WHERE status = 'failed') AS medicines_failed,
          (SELECT COUNT(*) FROM clinical_queries WHERE status = 'ok' AND n_results = 0)
            AS medicines_no_records,
          (SELECT COUNT(*) FROM clinical_queries WHERE status = 'ok' AND n_results > 0)
            AS medicines_with_records,
          (SELECT COUNT(*) FROM clinical_trials) AS trials_stored,
          (SELECT COUNT(DISTINCT nct_id) FROM clinical_trials) AS distinct_studies
        """
    ).fetchone()
    return {k: row[k] for k in row.keys()}


def query_clinical_evidence(
    conn: sqlite3.Connection,
    cfg: Config,
    run: PipelineRun,
    *,
    limit: int,
    refresh: bool,
    min_probability: float | None = None,
    retry_failed: bool = False,
    delay: float = DEFAULT_REQUEST_DELAY,
) -> None:
    """Query ClinicalTrials.gov for each medicine that still needs one."""
    client = ClinicalTrialsClient(cfg)
    rows = candidates_to_query(
        conn,
        cfg,
        limit=limit,
        refresh=refresh,
        min_probability=min_probability,
        retry_failed=retry_failed,
    )
    total = len(rows)
    log.info("querying ClinicalTrials.gov for %d medicines", total)

    total_trials = 0
    n_failed = 0
    n_zero = 0
    started = time.time()
    try:
        for index, row in enumerate(rows, start=1):
            run.processed += 1
            molecule_id = row["molecule_id"]
            # Orange Book ingredient strings can be long combination names;
            # query with the first component, which is what a registry search
            # would match.
            term = query_term_for(str(row["query_name"]))
            if not term:
                run.record_error(f"clinical:{molecule_id}", "no usable query term")
                continue

            try:
                trials = client.search_drug(term)
            except NetworkDisabledError:
                raise
            except Exception as exc:
                n_failed += 1
                run.record_error(f"clinical:{molecule_id}", exc)
                conn.execute(
                    """INSERT INTO clinical_queries(molecule_id, query_term, n_results, n_amr,
                           status, error, retrieved_at)
                       VALUES(?,?,0,0,'failed',?,?)
                       ON CONFLICT(molecule_id) DO UPDATE SET
                           query_term = excluded.query_term,
                           status = 'failed', error = excluded.error,
                           retrieved_at = excluded.retrieved_at""",
                    (molecule_id, term, str(exc)[:1000], utcnow()),
                )
                conn.commit()
                continue

            n_amr = sum(1 for t in trials if t.amr_related)
            total_trials += len(trials)

            if trials:
                conn.executemany(
                    """INSERT INTO clinical_trials(nct_id, molecule_id, query_term, brief_title,
                           conditions, interventions, phase, overall_status, study_type,
                           start_date, completion_date, enrollment, url, amr_related,
                           matched_keywords, retrieved_at, is_demo)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
                       ON CONFLICT(nct_id, molecule_id) DO UPDATE SET
                           overall_status = excluded.overall_status,
                           amr_related = excluded.amr_related,
                           retrieved_at = excluded.retrieved_at""",
                    [
                        (
                            t.nct_id, molecule_id, term, t.brief_title,
                            "; ".join(t.conditions)[:1000], "; ".join(t.interventions)[:1000],
                            t.phase, t.overall_status, t.study_type, t.start_date,
                            t.completion_date, t.enrollment, t.url, int(t.amr_related),
                            ", ".join(t.matched_keywords)[:500], utcnow(),
                        )
                        for t in trials
                    ],
                )

            conn.execute(
                """INSERT INTO clinical_queries(molecule_id, query_term, n_results, n_amr,
                       status, error, retrieved_at)
                   VALUES(?,?,?,?,'ok',NULL,?)
                   ON CONFLICT(molecule_id) DO UPDATE SET
                       query_term = excluded.query_term, n_results = excluded.n_results,
                       n_amr = excluded.n_amr, status = 'ok', error = NULL,
                       retrieved_at = excluded.retrieved_at""",
                (molecule_id, term, len(trials), n_amr, utcnow()),
            )
            conn.commit()
            run.new += len(trials)
            if not trials:
                n_zero += 1
                run.skipped += 1

            if index % 50 == 0 or index == total:
                elapsed = time.time() - started
                log.info(
                    "clinical lookup %d/%d (%.1f%%) - %d studies stored, %d failures, %.0fs elapsed",
                    index, total, 100.0 * index / max(total, 1), total_trials, n_failed, elapsed,
                )
            if delay > 0 and index < total:
                time.sleep(delay)

        record_source(conn, "ClinicalTrials.gov",
                      cfg.get("ingestion", "clinicaltrials", "base_url"), total_trials,
                      notes="retrospective human clinical history; not antimicrobial efficacy evidence")
        run.note("medicines_attempted", total)
        run.note("medicines_failed", n_failed)
        run.note("medicines_zero_results", n_zero)
        run.note("trials_stored", total_trials)
        run.note("query_seconds", round(time.time() - started, 1))
        run.note("coverage", coverage_snapshot(conn))
    finally:
        client.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch clinical evidence for approved medicines")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--refresh", action="store_true", help="re-query drugs already looked up")
    parser.add_argument("--retry-failed", action="store_true",
                        help="re-query only drugs whose last lookup failed")
    parser.add_argument("--all", action="store_true",
                        help="query the whole scored approved library, not just the shortlist")
    parser.add_argument("--min-probability", type=float, default=None,
                        help="override the shortlist probability threshold")
    parser.add_argument("--delay", type=float, default=DEFAULT_REQUEST_DELAY,
                        help="seconds to wait between requests")
    args = parser.parse_args(argv)

    min_probability = args.min_probability
    if args.all:
        min_probability = 0.0

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    with session(cfg) as conn:
        init_db(conn, cfg)
        with stage_run(conn, "clinical", params=vars(args)) as run:
            if cfg.offline:
                run.status = STATUS_SKIPPED
                run.message = "AMR_OFFLINE=1: clinical lookup skipped"
                return 0
            try:
                query_clinical_evidence(
                    conn, cfg, run,
                    limit=args.limit,
                    refresh=args.refresh,
                    min_probability=min_probability,
                    retry_failed=args.retry_failed,
                    delay=args.delay,
                )
            except NetworkDisabledError as exc:
                run.status = STATUS_SKIPPED
                run.message = str(exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
