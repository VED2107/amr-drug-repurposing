"""ClinicalTrials.gov API v2 client.

IMPORTANT SCIENTIFIC BOUNDARY
-----------------------------
A clinical trial record establishes that a drug has been studied in humans for
some indication. It is NOT evidence of antimicrobial activity. Records are tagged
``amr_related`` only when the trial's own conditions or title name an infection
or resistance context, and even then the tag means "this trial is about
infection", not "this drug treats resistant infection".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from ..config import Config
from ..logging_utils import get_logger
from ..ingestion.http import HttpClient

log = get_logger("amr.clinical")


@dataclass
class TrialRecord:
    """One ClinicalTrials.gov study, flattened to the fields we display."""

    nct_id: str
    brief_title: str | None
    conditions: list[str] = field(default_factory=list)
    interventions: list[str] = field(default_factory=list)
    phase: str | None = None
    overall_status: str | None = None
    study_type: str | None = None
    start_date: str | None = None
    completion_date: str | None = None
    enrollment: int | None = None
    amr_related: bool = False
    matched_keywords: list[str] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f"https://clinicaltrials.gov/study/{self.nct_id}"


def classify_amr_relevance(
    record: TrialRecord, keywords: Iterable[str]
) -> tuple[bool, list[str]]:
    """Flag a trial as infection/AMR-related based on its own stated context.

    Only the title and conditions are searched. Intervention text is excluded
    deliberately: an antibiotic given as background therapy in an oncology
    trial would otherwise make that trial look like AMR evidence.
    """
    haystack = " ".join(filter(None, [record.brief_title or "", *record.conditions])).lower()
    matched = sorted({kw for kw in keywords if kw.lower() in haystack})
    return bool(matched), matched


def _parse_study(study: dict[str, Any]) -> TrialRecord | None:
    """Flatten one API v2 study object. Returns None for unusable payloads."""
    protocol = study.get("protocolSection") or {}
    ident = protocol.get("identificationModule") or {}
    nct_id = ident.get("nctId")
    if not nct_id:
        return None

    status_mod = protocol.get("statusModule") or {}
    design = protocol.get("designModule") or {}
    conditions_mod = protocol.get("conditionsModule") or {}
    arms = protocol.get("armsInterventionsModule") or {}

    interventions = [
        i.get("name")
        for i in (arms.get("interventions") or [])
        if isinstance(i, dict) and i.get("name")
    ]
    phases = design.get("phases") or []
    enrollment_info = design.get("enrollmentInfo") or {}

    def date_of(key: str) -> str | None:
        node = status_mod.get(key) or {}
        return node.get("date") if isinstance(node, dict) else None

    return TrialRecord(
        nct_id=nct_id,
        brief_title=ident.get("briefTitle"),
        conditions=[c for c in (conditions_mod.get("conditions") or []) if c],
        interventions=interventions,
        phase=", ".join(phases) if phases else None,
        overall_status=status_mod.get("overallStatus"),
        study_type=design.get("studyType"),
        start_date=date_of("startDateStruct"),
        completion_date=date_of("completionDateStruct"),
        enrollment=enrollment_info.get("count"),
    )


class ClinicalTrialsClient:
    """Reader for the ClinicalTrials.gov v2 REST API."""

    def __init__(self, cfg: Config, http: HttpClient | None = None):
        self.cfg = cfg
        self.http = http or HttpClient(cfg)
        self.base = cfg.get("ingestion", "clinicaltrials", "base_url")
        self.page_size = int(cfg.get("ingestion", "clinicaltrials", "page_size", default=50))
        self.max_per_drug = int(cfg.get("ingestion", "clinicaltrials", "max_studies_per_drug", default=50))
        self.keywords = list(cfg.get("ingestion", "clinicaltrials", "amr_keywords", default=[]))

    def search_drug(self, drug_name: str, *, limit: int | None = None) -> list[TrialRecord]:
        """Return studies whose intervention matches ``drug_name``.

        A network or parsing failure raises; callers record the failure against
        the drug and move on rather than aborting the batch.
        """
        if not drug_name or not drug_name.strip():
            return []

        cap = limit or self.max_per_drug
        collected: list[TrialRecord] = []
        page_token: str | None = None

        while len(collected) < cap:
            params: dict[str, Any] = {
                "query.intr": drug_name.strip(),
                "pageSize": min(self.page_size, cap - len(collected)),
                "countTotal": "true",
            }
            if page_token:
                params["pageToken"] = page_token

            payload = self.http.get_json(self.base, params=params)
            studies = payload.get("studies") or []
            if not studies:
                break

            for study in studies:
                record = _parse_study(study)
                if record is None:
                    continue
                record.amr_related, record.matched_keywords = classify_amr_relevance(
                    record, self.keywords
                )
                collected.append(record)
                if len(collected) >= cap:
                    break

            page_token = payload.get("nextPageToken")
            if not page_token:
                break

        log.debug("ClinicalTrials.gov: %s -> %d studies", drug_name, len(collected))
        return collected

    def close(self) -> None:
        self.http.close()
