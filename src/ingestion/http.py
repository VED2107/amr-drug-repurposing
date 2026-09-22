"""Shared HTTP client: retries, backoff, rate-limit handling, offline mode.

Every outbound request in the project goes through this client so that timeout,
retry and offline behaviour is consistent and testable.
"""

from __future__ import annotations

import time
from typing import Any, Mapping

import requests

from ..config import Config
from ..logging_utils import get_logger

log = get_logger("amr.http")


class NetworkDisabledError(RuntimeError):
    """Raised when a network call is attempted while AMR_OFFLINE=1."""


class HttpClient:
    """Requests session with bounded retries and honest failure reporting."""

    RETRY_STATUS = {429, 500, 502, 503, 504}

    def __init__(self, cfg: Config, session: requests.Session | None = None):
        self.cfg = cfg
        self.timeout = float(cfg.get("network", "timeout_seconds", default=60))
        self.max_retries = int(cfg.get("network", "max_retries", default=3))
        self.backoff = float(cfg.get("network", "backoff_seconds", default=2.0))
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": cfg.user_agent, "Accept": "application/json"})

    def get(self, url: str, params: Mapping[str, Any] | None = None,
            *, stream: bool = False, accept: str | None = None,
            user_agent: str | None = None) -> requests.Response:
        """GET with retry/backoff. Raises on final failure.

        ``user_agent`` overrides the session default for a single call. The FDA
        content CDN returns 404 for non-browser user agents on its public data
        files, so the Orange Book fetch has to present one.
        """
        if self.cfg.offline:
            raise NetworkDisabledError(f"AMR_OFFLINE=1 blocks the request to {url}")

        headers: dict[str, str] | None = None
        if accept:
            headers = {"Accept": accept}
        if user_agent:
            headers = {**(headers or {}), "User-Agent": user_agent}
        last_exc: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.session.get(
                    url, params=params, timeout=self.timeout, stream=stream, headers=headers
                )
                if resp.status_code in self.RETRY_STATUS:
                    # Respect an explicit Retry-After when the server sends one.
                    wait = self.backoff * attempt
                    retry_after = resp.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait = max(wait, float(retry_after))
                        except ValueError:
                            pass
                    log.warning("HTTP %s from %s (attempt %d/%d), retrying in %.1fs",
                                resp.status_code, url, attempt, self.max_retries, wait)
                    if attempt < self.max_retries:
                        time.sleep(wait)
                        continue
                resp.raise_for_status()
                return resp
            except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as exc:
                last_exc = exc
                if attempt >= self.max_retries:
                    break
                wait = self.backoff * attempt
                log.warning("request to %s failed (%s), attempt %d/%d, retrying in %.1fs",
                            url, type(exc).__name__, attempt, self.max_retries, wait)
                time.sleep(wait)

        raise RuntimeError(f"GET {url} failed after {self.max_retries} attempts: {last_exc}") from last_exc

    def get_json(self, url: str, params: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """GET and parse JSON. A malformed body is reported as a clear error."""
        resp = self.get(url, params=params)
        try:
            data = resp.json()
        except ValueError as exc:
            snippet = resp.text[:200].replace("\n", " ")
            raise RuntimeError(f"malformed JSON from {url}: {exc} | body starts: {snippet!r}") from exc
        if not isinstance(data, dict):
            raise RuntimeError(f"expected a JSON object from {url}, got {type(data).__name__}")
        return data

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
