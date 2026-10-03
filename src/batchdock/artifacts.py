"""Artifact storage: files on disk, bytes in object storage, identity in the database.

Every file a docking result depends on — the source PDB, the prepared receptor,
the ligand SDF and PDBQT, the pose file and the engine log — is written once,
checksummed, and recorded in `docking.artifacts` by object key.

The local directory is a cache. When Supabase Storage is configured it is the
shared store: a worker on another machine that does not have a file fetches it
by key and refuses it unless its SHA-256 matches the database. No worker
depends on another worker's filesystem.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import requests

from ..logging_utils import get_logger
from .config import Settings

log = get_logger("amr.batchdock.artifacts")


class ArtifactError(RuntimeError):
    """An artifact is missing, corrupted, or could not be stored."""


@dataclass(frozen=True)
class Staged:
    """Bytes written (and uploaded), not yet registered in the database."""

    kind: str
    object_key: str
    sha256: str
    size_bytes: int
    content_type: str
    bucket: str | None


@dataclass(frozen=True)
class Artifact:
    id: int
    kind: str
    object_key: str
    sha256: str
    size_bytes: int


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class ArtifactStore:
    """Write, register and fetch artifacts. Thread-safe apart from the DB connection
    passed in by the caller."""

    def __init__(self, settings: Settings) -> None:
        self.root = settings.artifact_dir
        self.root.mkdir(parents=True, exist_ok=True)
        self.bucket = settings.storage_bucket
        self._url = (settings.storage_url or "").rstrip("/")
        self._key = settings.storage_key
        self.remote = settings.remote_storage
        self._local = threading.local()

    @property
    def _http(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = self._local.session = requests.Session()
        return session

    # -- paths ------------------------------------------------------------

    def local_path(self, object_key: str) -> Path:
        if object_key.startswith("/") or ".." in Path(object_key).parts:
            raise ArtifactError(f"unsafe object key {object_key!r}")
        return self.root / object_key

    # -- remote -----------------------------------------------------------

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self._key}", "apikey": str(self._key)}
        if content_type:
            h["Content-Type"] = content_type
        return h

    def ensure_bucket(self) -> None:
        if not self.remote:
            return
        resp = self._http.post(
            f"{self._url}/storage/v1/bucket", headers=self._headers("application/json"),
            json={"id": self.bucket, "name": self.bucket, "public": False}, timeout=30)
        if resp.status_code in (200, 201):
            log.info("created private storage bucket %s", self.bucket)
        elif resp.status_code in (400, 409) and "exist" in resp.text.lower():
            pass
        else:
            raise ArtifactError(f"could not ensure bucket {self.bucket}: HTTP {resp.status_code} {resp.text[:200]}")

    def _upload(self, object_key: str, data: bytes, content_type: str) -> None:
        url = f"{self._url}/storage/v1/object/{self.bucket}/{quote(object_key)}"
        last = ""
        for attempt in range(4):
            try:
                resp = self._http.post(
                    url, data=data, timeout=60,
                    headers={**self._headers(content_type), "x-upsert": "true"})
                if resp.status_code in (200, 201):
                    return
                last = f"HTTP {resp.status_code} {resp.text[:200]}"
                if resp.status_code < 500 and resp.status_code != 429:
                    break
            except requests.RequestException as exc:
                last = f"{type(exc).__name__}: {exc}"
            time.sleep(2 ** attempt)
        raise ArtifactError(f"upload of {object_key} failed: {last}")

    def _download(self, object_key: str) -> bytes:
        url = f"{self._url}/storage/v1/object/{self.bucket}/{quote(object_key)}"
        last = ""
        for attempt in range(4):
            try:
                resp = self._http.get(url, headers=self._headers(), timeout=60)
                if resp.status_code == 200:
                    return resp.content
                last = f"HTTP {resp.status_code}"
                if resp.status_code < 500 and resp.status_code != 429:
                    break
            except requests.RequestException as exc:
                last = f"{type(exc).__name__}: {exc}"
            time.sleep(2 ** attempt)
        raise ArtifactError(f"download of {object_key} failed: {last}")

    # -- public API -------------------------------------------------------

    def write(self, kind: str, object_key: str, data: bytes,
              content_type: str = "text/plain") -> "Staged":
        """Write bytes locally and upload them if remote storage is on.
        Thread-safe; touches no database connection."""
        if not data:
            raise ArtifactError(f"refusing to store empty artifact {object_key}")
        digest = sha256_bytes(data)
        path = self.local_path(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        bucket = None
        if self.remote:
            self._upload(object_key, data, content_type)
            bucket = self.bucket
        return Staged(kind, object_key, digest, len(data), content_type, bucket)

    def put(self, conn, kind: str, object_key: str, data: bytes,
            content_type: str = "text/plain") -> Artifact:
        """Write, upload and register in one call."""
        return self.register(conn, self.write(kind, object_key, data, content_type))

    def register(self, conn, staged: "Staged") -> Artifact:
        """Record a written artifact. Re-registering identical bytes is a no-op."""
        kind, object_key, digest, size = staged.kind, staged.object_key, staged.sha256, staged.size_bytes
        content_type, bucket = staged.content_type, staged.bucket
        row = conn.execute(
            """insert into docking.artifacts(kind, object_key, sha256, size_bytes, content_type,
                       remote_bucket, remote_uploaded_at)
               values (%s, %s, %s, %s, %s, %s, case when %s::text is null then null else now() end)
               on conflict (object_key) do update set
                   kind = excluded.kind, sha256 = excluded.sha256,
                   size_bytes = excluded.size_bytes, content_type = excluded.content_type,
                   remote_bucket = coalesce(excluded.remote_bucket, docking.artifacts.remote_bucket),
                   remote_uploaded_at = coalesce(excluded.remote_uploaded_at,
                                                 docking.artifacts.remote_uploaded_at)
               returning id""",
            (kind, object_key, digest, size, content_type, bucket, bucket),
        ).fetchone()
        return Artifact(int(row[0]), kind, object_key, digest, size)

    def register_many(self, conn, staged: list["Staged"]) -> dict[str, Artifact]:
        """Register many artifacts in one statement (one round trip). Keyed by object_key."""
        if not staged:
            return {}
        rows = conn.execute(
            """insert into docking.artifacts(kind, object_key, sha256, size_bytes, content_type,
                       remote_bucket, remote_uploaded_at)
               select k, o, s, z, c, b, case when b is null then null else now() end
                 from unnest(%s::text[], %s::text[], %s::text[], %s::bigint[], %s::text[], %s::text[])
                      as v(k, o, s, z, c, b)
               on conflict (object_key) do update set
                   kind = excluded.kind, sha256 = excluded.sha256, size_bytes = excluded.size_bytes,
                   content_type = excluded.content_type,
                   remote_bucket = coalesce(excluded.remote_bucket, docking.artifacts.remote_bucket),
                   remote_uploaded_at = coalesce(excluded.remote_uploaded_at,
                                                 docking.artifacts.remote_uploaded_at)
               returning id, object_key, kind, sha256, size_bytes""",
            ([s.kind for s in staged], [s.object_key for s in staged], [s.sha256 for s in staged],
             [s.size_bytes for s in staged], [s.content_type for s in staged],
             [s.bucket for s in staged])).fetchall()
        return {r[1]: Artifact(int(r[0]), r[2], r[1], r[3], int(r[4])) for r in rows}

    def fetch(self, object_key: str, sha256: str) -> Path:
        """Return a local path whose bytes match `sha256`, downloading if needed."""
        path = self.local_path(object_key)
        if path.exists() and sha256_file(path) == sha256:
            return path
        if not self.remote:
            state = "corrupted (checksum mismatch)" if path.exists() else "missing"
            raise ArtifactError(f"artifact {object_key} is {state} locally and no remote store is configured")
        data = self._download(object_key)
        if sha256_bytes(data) != sha256:
            raise ArtifactError(f"artifact {object_key} downloaded but its checksum does not match the database")
        path.parent.mkdir(parents=True, exist_ok=True)
        # Unique per thread: two slots may fetch the same ligand at the same moment.
        tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.dl")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return path

    def close(self) -> None:
        session = getattr(self._local, "session", None)
        if session is not None:
            session.close()
