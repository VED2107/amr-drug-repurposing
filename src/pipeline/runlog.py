"""Pipeline run tracking.

Wraps a stage so that its start, end, counts and per-item errors land in the
database whether the stage succeeds, fails or is interrupted. One failed drug
must never abort a batch, so :meth:`PipelineRun.record_error` is the normal way
to report a per-item problem.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

from ..db import utcnow
from ..logging_utils import get_logger

log = get_logger("amr.pipeline")

STATUS_RUNNING = "RUNNING"
STATUS_SUCCESS = "SUCCESS"
STATUS_PARTIAL = "PARTIAL"
STATUS_FAILED = "FAILED"
STATUS_SKIPPED = "SKIPPED"


@dataclass
class PipelineRun:
    """Mutable counters for one stage execution."""

    run_id: str
    stage: str
    conn: sqlite3.Connection
    started: float = field(default_factory=time.time)
    processed: int = 0
    new: int = 0
    skipped: int = 0
    errors: int = 0
    message: str = ""
    status: str = STATUS_RUNNING
    details: dict[str, Any] = field(default_factory=dict)

    def record_error(self, subject: str | None, exc: BaseException | str, *,
                     stage: str | None = None) -> None:
        """Log one per-item failure and continue."""
        self.errors += 1
        error_type = type(exc).__name__ if isinstance(exc, BaseException) else "Error"
        message = str(exc)
        try:
            self.conn.execute(
                """INSERT INTO pipeline_errors(run_id, stage, subject, error_type, message, created_at)
                   VALUES(?,?,?,?,?,?)""",
                (self.run_id, stage or self.stage, subject, error_type, message[:2000], utcnow()),
            )
        except sqlite3.Error as db_exc:  # never let error logging break the run
            log.debug("could not persist pipeline error: %s", db_exc)
        log.warning("%s: %s failed (%s: %s)", self.stage, subject, error_type, message[:200])

    def note(self, key: str, value: Any) -> None:
        self.details[key] = value


@contextmanager
def stage_run(
    conn: sqlite3.Connection,
    stage: str,
    *,
    params: dict[str, Any] | None = None,
    is_demo: bool = False,
) -> Iterator[PipelineRun]:
    """Context manager that opens and closes a pipeline_runs row."""
    run_id = f"{stage.upper()}-{uuid.uuid4().hex[:10]}"
    run = PipelineRun(run_id=run_id, stage=stage, conn=conn)

    conn.execute(
        """INSERT INTO pipeline_runs(run_id, stage, started_at, status, params_json, is_demo)
           VALUES(?,?,?,?,?,?)""",
        (run_id, stage, utcnow(), STATUS_RUNNING, json.dumps(params or {}, default=str), int(is_demo)),
    )
    conn.commit()
    log.info("stage %s started (run %s)", stage, run_id)

    try:
        yield run
    except BaseException as exc:
        run.status = STATUS_FAILED
        run.message = f"{type(exc).__name__}: {exc}"
        _finish(conn, run)
        log.error("stage %s failed: %s", stage, run.message)
        raise
    else:
        if run.status == STATUS_RUNNING:
            run.status = STATUS_PARTIAL if run.errors else STATUS_SUCCESS
        _finish(conn, run)
        log.info(
            "stage %s finished: %s (processed=%d new=%d skipped=%d errors=%d)",
            stage, run.status, run.processed, run.new, run.skipped, run.errors,
        )


def _finish(conn: sqlite3.Connection, run: PipelineRun) -> None:
    duration = time.time() - run.started
    message = run.message
    if run.details:
        detail_text = json.dumps(run.details, default=str)
        message = f"{message} | {detail_text}" if message else detail_text
    conn.execute(
        """UPDATE pipeline_runs
           SET finished_at = ?, duration_seconds = ?, status = ?, records_processed = ?,
               records_new = ?, records_skipped = ?, error_count = ?, message = ?
           WHERE run_id = ?""",
        (
            utcnow(), round(duration, 3), run.status, run.processed, run.new,
            run.skipped, run.errors, message[:4000] if message else None, run.run_id,
        ),
    )
    conn.commit()
