"""ChEMBL ingestion: bioactivity records and the approved-drug molecule set.

ChEMBL is the source of the *labelled* data. Nothing here invents an activity
value or a label; records without a usable potency measurement are stored with
``label = NULL`` and excluded from training.
"""

from __future__ import annotations

from typing import Any, Iterator

from ..config import Config, Pathogen
from ..logging_utils import get_logger
from .http import HttpClient

log = get_logger("amr.chembl")

# Fields we keep from the /activity endpoint. Everything else is discarded so
# the raw payloads do not bloat the database.
ACTIVITY_FIELDS = [
    "activity_id", "molecule_chembl_id", "parent_molecule_chembl_id",
    "molecule_pref_name", "canonical_smiles", "target_chembl_id",
    "target_pref_name", "target_organism", "assay_chembl_id",
    "assay_description", "assay_type", "standard_type", "standard_value",
    "standard_units", "standard_relation", "pchembl_value",
    "document_chembl_id", "document_year", "data_validity_comment",
]


class ChemblClient:
    """Paginated reader for the ChEMBL REST API."""

    def __init__(self, cfg: Config, http: HttpClient | None = None):
        self.cfg = cfg
        self.base = cfg.get("ingestion", "chembl", "base_url").rstrip("/")
        self.http = http or HttpClient(cfg)

    # ------------------------------------------------------------ activities
    def iter_activities(self, pathogen: Pathogen, *, limit: int | None = None) -> Iterator[dict[str, Any]]:
        """Yield activity records for one pathogen, filtered at the API where possible.

        The API filter is on ``target_organism``; activity-type and unit
        filtering happens client-side because ChEMBL does not support an
        ``in`` filter on those fields in a single request.
        """
        page_size = int(self.cfg.get("ingestion", "chembl", "page_size", default=1000))
        cap = limit or int(self.cfg.get("ingestion", "chembl", "max_activities_per_pathogen", default=12000))
        accepted_types = {t.upper() for t in self.cfg.get("ingestion", "chembl", "accepted_activity_types", default=[])}
        accepted_units = {u.lower() for u in self.cfg.get("ingestion", "chembl", "accepted_units", default=[])}

        url = f"{self.base}/activity.json"
        offset = 0
        yielded = 0

        while yielded < cap:
            params = {
                "target_organism": pathogen.organism,
                "limit": min(page_size, cap),
                "offset": offset,
            }
            payload = self.http.get_json(url, params=params)
            activities = payload.get("activities") or []
            if not activities:
                break

            for rec in activities:
                stype = (rec.get("standard_type") or "").upper()
                sunits = (rec.get("standard_units") or "").lower()
                if accepted_types and stype not in accepted_types:
                    continue
                if accepted_units and sunits not in accepted_units:
                    continue
                if rec.get("standard_value") is None:
                    continue
                if not rec.get("canonical_smiles"):
                    continue
                yield {k: rec.get(k) for k in ACTIVITY_FIELDS}
                yielded += 1
                if yielded >= cap:
                    break

            meta = payload.get("page_meta") or {}
            total = meta.get("total_count")
            offset += len(activities)
            if total is not None and offset >= int(total):
                break

        log.info("ChEMBL: %s -> %d usable activity records", pathogen.label, yielded)

    # ------------------------------------------------------- approved drugs
    def iter_approved_molecules(self, *, limit: int | None = None) -> Iterator[dict[str, Any]]:
        """Yield ChEMBL molecules at max_phase 4 (approved).

        These carry reliable structures and are used both as a screening
        library and as the structure source when mapping Orange Book
        ingredient names to molecules.
        """
        page_size = int(self.cfg.get("ingestion", "chembl", "approved_drug_page_size", default=1000))
        cap = limit or int(self.cfg.get("ingestion", "chembl", "max_approved_drugs", default=5000))
        max_phase = self.cfg.get("ingestion", "chembl", "approved_drug_max_phase", default=4)

        url = f"{self.base}/molecule.json"
        offset = 0
        yielded = 0

        while yielded < cap:
            params = {"max_phase": max_phase, "limit": min(page_size, cap), "offset": offset}
            payload = self.http.get_json(url, params=params)
            molecules = payload.get("molecules") or []
            if not molecules:
                break

            for mol in molecules:
                structures = mol.get("molecule_structures") or {}
                smiles = structures.get("canonical_smiles")
                if not smiles:
                    continue
                props = mol.get("molecule_properties") or {}
                yield {
                    "chembl_id": mol.get("molecule_chembl_id"),
                    "pref_name": (mol.get("pref_name") or "").strip() or None,
                    "canonical_smiles": smiles,
                    "inchi_key": structures.get("standard_inchi_key"),
                    "max_phase": mol.get("max_phase"),
                    "first_approval": mol.get("first_approval"),
                    "molecule_type": mol.get("molecule_type"),
                    "oral": mol.get("oral"),
                    "parenteral": mol.get("parenteral"),
                    "topical": mol.get("topical"),
                    "natural_product": mol.get("natural_product"),
                    "full_mwt": props.get("full_mwt"),
                    "synonyms": [
                        s.get("molecule_synonym")
                        for s in (mol.get("molecule_synonyms") or [])
                        if s.get("molecule_synonym")
                    ],
                }
                yielded += 1
                if yielded >= cap:
                    break

            meta = payload.get("page_meta") or {}
            total = meta.get("total_count")
            offset += len(molecules)
            if total is not None and offset >= int(total):
                break

        log.info("ChEMBL: %d approved molecules with structures", yielded)

    def close(self) -> None:
        self.http.close()
