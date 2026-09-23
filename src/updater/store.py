"""The published database, as the worker sees it.

This is the one part of the worker that is not borrowed from the existing
engine, because the engine writes SQLite and this writes the published Postgres
schema. It writes nothing the schema does not already describe: no new tables,
no extra columns, no parallel notion of a medicine.

Three rules shape every statement here.

*Idempotence.* Every write is an upsert keyed on what the schema already treats
as identity — ``molecules.molecule_id``, ``drugs.drug_id`` and the
``(molecule_id, pathogen_key, model_version)`` uniqueness on predictions. Running
the worker twice produces the same database as running it once.

*Preservation.* An existing prediction for the same molecule, pathogen and model
version is left alone. The same model over the same fingerprint yields the same
number, so rewriting it would churn ``predicted_at`` for nothing and destroy the
record of when the value was actually produced.

*Ids.* Several tables carry a bare ``bigint`` primary key with no default,
because they were copied from SQLite's ``AUTOINCREMENT``. New rows therefore
allocate ids explicitly, from the current maximum, inside the same transaction
that inserts them.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterator, Sequence

import psycopg
from psycopg.rows import dict_row

from ..logging_utils import get_logger

log = get_logger("amr.updater.store")

SCHEMA = "amr"


@dataclass(frozen=True)
class ActiveModel:
    """One production model, as the published registry describes it."""

    pathogen_key: str
    model_version: str
    model_type: str | None
    dataset_version: str | None
    feature_version: str | None
    artifact_path: str | None


@dataclass(frozen=True)
class PublishedState:
    """What the published database already holds, before this run."""

    molecule_ids: frozenset[str]
    drug_ids: frozenset[str]
    scored: frozenset[tuple[str, str, str]]
    """(molecule_id, pathogen_key, model_version) triples already predicted."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SupabaseStore:
    """Read published state, write new medicines and predictions."""

    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._conn: psycopg.Connection | None = None

    # -- lifecycle --------------------------------------------------------

    def connect(self) -> None:
        # The search path travels as a startup parameter, not a SET. Through
        # Supabase's transaction pooler each transaction may run on a different
        # backend, so a SET committed in one transaction is not there for the
        # next: a run failed with 'relation "model_versions" does not exist'
        # on its first read. It also left the setting behind on a shared
        # backend for whichever client got that backend next.
        self._conn = psycopg.connect(
            self._url,
            row_factory=dict_row,
            options=f"-c search_path={SCHEMA},public",
        )

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> "SupabaseStore":
        self.connect()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def conn(self) -> psycopg.Connection:
        if self._conn is None:
            raise RuntimeError("store is not connected")
        return self._conn

    @contextmanager
    def transaction(self) -> Iterator[psycopg.Connection]:
        """One unit of work. A failure rolls back only what it wrapped."""
        with self.conn.transaction():
            yield self.conn

    # -- reading ----------------------------------------------------------

    def active_models(self) -> dict[str, ActiveModel]:
        """The ACTIVE model per pathogen, from the published registry.

        The registry is the authority on which model is in service. The worker
        reads it rather than assuming, so that a model promoted locally and
        published is picked up without changing the container.
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select pathogen_key, model_version, model_type, dataset_version,
                       feature_version, artifact_path
                  from model_versions
                 where status = 'ACTIVE'
                 order by pathogen_key
                """
            )
            rows = cur.fetchall()

        return {
            r["pathogen_key"]: ActiveModel(
                pathogen_key=r["pathogen_key"],
                model_version=r["model_version"],
                model_type=r["model_type"],
                dataset_version=r["dataset_version"],
                feature_version=r["feature_version"],
                artifact_path=r["artifact_path"],
            )
            for r in rows
        }

    def published_state(self, model_versions: Sequence[str]) -> PublishedState:
        """Everything already published that this run must not duplicate."""
        with self.conn.cursor() as cur:
            cur.execute("select molecule_id from molecules")
            molecules = frozenset(r["molecule_id"] for r in cur.fetchall())

            cur.execute("select drug_id from drugs")
            drugs = frozenset(r["drug_id"] for r in cur.fetchall())

            scored: set[tuple[str, str, str]] = set()
            if model_versions:
                cur.execute(
                    """
                    select molecule_id, pathogen_key, model_version
                      from predictions
                     where model_version = any(%s)
                    """,
                    (list(model_versions),),
                )
                scored = {
                    (r["molecule_id"], r["pathogen_key"], r["model_version"])
                    for r in cur.fetchall()
                }

        log.info(
            "[AMR UPDATE] published state: %d molecules, %d products, %d predictions "
            "under the current models",
            len(molecules), len(drugs), len(scored),
        )
        return PublishedState(
            molecule_ids=molecules, drug_ids=drugs, scored=frozenset(scored)
        )

    def known_pathogens(self) -> frozenset[str]:
        with self.conn.cursor() as cur:
            cur.execute("select key from pathogens")
            return frozenset(r["key"] for r in cur.fetchall())

    def _next_id(self, cur: psycopg.Cursor, table: str) -> int:
        cur.execute(f"select coalesce(max(id), 0) + 1 as next from {table}")
        row = cur.fetchone()
        return int(row["next"]) if row else 1

    # -- writing ----------------------------------------------------------

    def start_run(self, run_id: str, stage: str, params: dict[str, Any]) -> None:
        """Record that a run began, before anything else is written.

        The run row exists first so that a crash mid-run still leaves evidence
        that the run happened, rather than a silent gap.
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into pipeline_runs
                    (run_id, stage, started_at, status, records_processed,
                     records_new, records_skipped, error_count, params_json)
                values (%s, %s, %s, 'RUNNING', 0, 0, 0, 0, %s)
                on conflict (run_id) do nothing
                """,
                (run_id, stage, utcnow(), psycopg.types.json.Json(params)),
            )
        self.conn.commit()

    def finish_run(
        self,
        run_id: str,
        *,
        status: str,
        processed: int,
        new: int,
        skipped: int,
        errors: int,
        message: str,
        started: datetime,
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                update pipeline_runs
                   set finished_at = %s,
                       duration_seconds = %s,
                       status = %s,
                       records_processed = %s,
                       records_new = %s,
                       records_skipped = %s,
                       error_count = %s,
                       message = %s
                 where run_id = %s
                """,
                (
                    utcnow(),
                    (utcnow() - started).total_seconds(),
                    status,
                    processed,
                    new,
                    skipped,
                    errors,
                    message[:2000],
                    run_id,
                ),
            )
        self.conn.commit()

    def record_error(self, run_id: str, stage: str, subject: str, message: str) -> None:
        """One per-item failure. A bad record never aborts the batch."""
        with self.conn.cursor() as cur:
            next_id = self._next_id(cur, "pipeline_errors")
            cur.execute(
                """
                insert into pipeline_errors
                    (id, run_id, stage, subject, error_type, message, created_at)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                (next_id, run_id, stage, subject[:200], "updater", message[:2000], utcnow()),
            )
        self.conn.commit()

    def upsert_molecule(self, record: dict[str, Any]) -> None:
        """Store one standardised structure.

        Existing identity columns are preserved with ``coalesce`` in the same
        spirit as the pipeline's own upsert: a later source that omits a field
        must not erase what an earlier one supplied.
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into molecules (
                    molecule_id, chembl_id, pref_name, input_smiles, canonical_smiles,
                    inchi, inchikey, mw, logp, tpsa, hbd, hba, rotatable_bonds,
                    aromatic_rings, heavy_atoms, fraction_csp3, qed, lipinski_violations,
                    murcko_scaffold, feature_version, is_valid, validation_error,
                    created_at, updated_at
                ) values (
                    %(molecule_id)s, %(chembl_id)s, %(pref_name)s, %(input_smiles)s,
                    %(canonical_smiles)s, %(inchi)s, %(inchikey)s, %(mw)s, %(logp)s,
                    %(tpsa)s, %(hbd)s, %(hba)s, %(rotatable_bonds)s, %(aromatic_rings)s,
                    %(heavy_atoms)s, %(fraction_csp3)s, %(qed)s, %(lipinski_violations)s,
                    %(murcko_scaffold)s, %(feature_version)s, true, null,
                    %(created_at)s, %(updated_at)s
                )
                on conflict (molecule_id) do update set
                    chembl_id        = coalesce(molecules.chembl_id, excluded.chembl_id),
                    pref_name        = coalesce(molecules.pref_name, excluded.pref_name),
                    canonical_smiles = excluded.canonical_smiles,
                    inchi            = excluded.inchi,
                    inchikey         = excluded.inchikey,
                    mw               = excluded.mw,
                    logp             = excluded.logp,
                    tpsa             = excluded.tpsa,
                    hbd              = excluded.hbd,
                    hba              = excluded.hba,
                    rotatable_bonds  = excluded.rotatable_bonds,
                    aromatic_rings   = excluded.aromatic_rings,
                    heavy_atoms      = excluded.heavy_atoms,
                    fraction_csp3    = excluded.fraction_csp3,
                    qed              = excluded.qed,
                    lipinski_violations = excluded.lipinski_violations,
                    murcko_scaffold  = excluded.murcko_scaffold,
                    feature_version  = excluded.feature_version,
                    is_valid         = true,
                    validation_error = null,
                    updated_at       = excluded.updated_at
                """,
                record,
            )

    def upsert_drug(self, record: dict[str, Any]) -> None:
        """Store one approved product, keyed the way the pipeline keys it."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into drugs (
                    drug_id, molecule_id, generic_name, brand_name, approval_source,
                    approval_status, application_no, application_type, marketing_status,
                    dosage_form, route, approval_date, chembl_id, match_method,
                    first_seen_at, processing_status, prediction_status
                ) values (
                    %(drug_id)s, %(molecule_id)s, %(generic_name)s, %(brand_name)s,
                    %(approval_source)s, %(approval_status)s, %(application_no)s,
                    %(application_type)s, %(marketing_status)s, %(dosage_form)s,
                    %(route)s, %(approval_date)s, %(chembl_id)s, %(match_method)s,
                    %(first_seen_at)s, %(processing_status)s, %(prediction_status)s
                )
                on conflict (drug_id) do update set
                    molecule_id      = coalesce(excluded.molecule_id, drugs.molecule_id),
                    marketing_status = excluded.marketing_status,
                    match_method     = excluded.match_method,
                    prediction_status = excluded.prediction_status
                """,
                record,
            )

    def insert_predictions(self, rows: Sequence[dict[str, Any]]) -> int:
        """Write predictions, skipping any that already exist.

        ``do nothing`` rather than ``do update``: the same model over the same
        fingerprint produces the same probability, so an existing row is already
        correct and its ``predicted_at`` is a fact about when it was produced.
        """
        if not rows:
            return 0

        with self.conn.cursor() as cur:
            next_id = self._next_id(cur, "predictions")
            payload = [
                (
                    next_id + offset,
                    r["molecule_id"],
                    r["pathogen_key"],
                    r["probability"],
                    r["model_version"],
                    r["model_type"],
                    r["dataset_version"],
                    r["feature_version"],
                    r["predicted_at"],
                )
                for offset, r in enumerate(rows)
            ]
            cur.executemany(
                """
                insert into predictions (
                    id, molecule_id, pathogen_key, probability, model_version,
                    model_type, dataset_version, feature_version, predicted_at
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (molecule_id, pathogen_key, model_version) do nothing
                """,
                payload,
            )
            written = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else len(payload)
        return written

    def record_source(
        self,
        name: str,
        url: str | None,
        record_count: int,
        *,
        source_version: str | None = None,
        notes: str | None = None,
    ) -> None:
        """Note that a source was consulted, and what it yielded."""
        with self.conn.cursor() as cur:
            next_id = self._next_id(cur, "data_sources")
            cur.execute(
                """
                insert into data_sources
                    (id, name, url, source_version, retrieved_at, record_count, notes)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                (next_id, name, url, source_version, utcnow(), record_count, notes),
            )
        self.conn.commit()

    def published_probabilities(
        self, molecule_ids: Sequence[str], model_versions: Sequence[str]
    ) -> dict[tuple[str, str, str], float]:
        """The live probability per (molecule, pathogen, model version).

        Read for the self-test's known answers, so the container proves it
        reproduces what the website is actually showing, not only a file.
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select molecule_id, pathogen_key, model_version, probability
                  from predictions
                 where molecule_id = any(%s) and model_version = any(%s)
                """,
                (list(molecule_ids), list(model_versions)),
            )
            return {
                (r["molecule_id"], r["pathogen_key"], r["model_version"]): float(r["probability"])
                for r in cur.fetchall()
            }

    def count_predictions_for(self, model_versions: Sequence[str]) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "select count(*) as n from predictions where model_version = any(%s)",
                (list(model_versions),),
            )
            row = cur.fetchone()
            return int(row["n"]) if row else 0
