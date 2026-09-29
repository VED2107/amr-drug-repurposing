"""Ingestion clients, exercised against deterministic fakes rather than the network."""

from __future__ import annotations

import io
import zipfile

import pytest
import requests

from src.clinical.evidence import ClinicalTrialsClient, TrialRecord, _parse_study, classify_amr_relevance
from src.ingestion.chembl import ChemblClient
from src.ingestion.http import HttpClient, NetworkDisabledError
from src.ingestion.orange_book import (
    ApprovedProduct,
    OrangeBookClient,
    build_name_index,
    iter_unique_products,
    match_product_to_molecule,
    normalize_drug_name,
    split_ingredients,
)


class FakeResponse:
    def __init__(self, payload=None, *, status_code=200, content=b"", text="", headers=None):
        self._payload = payload
        self.status_code = status_code
        self.content = content
        self.text = text or (content.decode("utf-8", "replace") if content else "")
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no JSON object could be decoded")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeSession:
    """Replays a queued list of responses, recording the calls made."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}

    def get(self, url, params=None, timeout=None, stream=False, headers=None):
        self.calls.append({"url": url, "params": params, "headers": headers})
        if not self.responses:
            raise AssertionError(f"unexpected extra request to {url}")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        pass


class TestHttpClient:
    def test_offline_mode_blocks_every_request(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "1")
        client = HttpClient(cfg, session=FakeSession([]))
        with pytest.raises(NetworkDisabledError):
            client.get("https://example.org")

    def test_retries_then_succeeds(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        monkeypatch.setattr("src.ingestion.http.time.sleep", lambda *_: None)
        session = FakeSession([
            FakeResponse(status_code=503),
            FakeResponse({"ok": True}),
        ])
        client = HttpClient(cfg, session=session)
        assert client.get_json("https://example.org") == {"ok": True}
        assert len(session.calls) == 2

    def test_gives_up_after_the_configured_attempts(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        monkeypatch.setattr("src.ingestion.http.time.sleep", lambda *_: None)
        session = FakeSession([FakeResponse(status_code=500) for _ in range(5)])
        client = HttpClient(cfg, session=session)
        with pytest.raises(RuntimeError, match="failed after"):
            client.get("https://example.org")

    def test_malformed_json_is_reported_clearly(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        session = FakeSession([FakeResponse(None, text="<html>not json</html>")])
        client = HttpClient(cfg, session=session)
        with pytest.raises(RuntimeError, match="malformed JSON"):
            client.get_json("https://example.org")

    def test_timeout_is_retried_then_raised(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        monkeypatch.setattr("src.ingestion.http.time.sleep", lambda *_: None)
        session = FakeSession([requests.Timeout("slow") for _ in range(4)])
        client = HttpClient(cfg, session=session)
        with pytest.raises(RuntimeError):
            client.get("https://example.org")

    def test_per_call_user_agent_override_is_sent(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        session = FakeSession([FakeResponse({"ok": True})])
        client = HttpClient(cfg, session=session)
        client.get("https://example.org", user_agent="Custom/1.0")
        assert session.calls[0]["headers"]["User-Agent"] == "Custom/1.0"


def _activity(**overrides):
    base = {
        "activity_id": 1,
        "molecule_chembl_id": "CHEMBL25",
        "molecule_pref_name": "ASPIRIN",
        "canonical_smiles": "CC(=O)Oc1ccccc1C(=O)O",
        "target_organism": "Escherichia coli",
        "standard_type": "MIC",
        "standard_value": 4.0,
        "standard_units": "ug.mL-1",
        "standard_relation": "=",
        "pchembl_value": None,
        "assay_description": "Antibacterial activity against E. coli",
    }
    base.update(overrides)
    return base


class TestChemblClient:
    def test_only_accepted_endpoints_and_units_are_kept(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        payload = {
            "activities": [
                _activity(activity_id=1),
                _activity(activity_id=2, standard_type="Solubility"),   # wrong endpoint
                _activity(activity_id=3, standard_units="percent"),     # wrong units
                _activity(activity_id=4, standard_value=None),          # no value
                _activity(activity_id=5, canonical_smiles=None),        # no structure
            ],
            "page_meta": {"total_count": 5},
        }
        client = ChemblClient(cfg, http=HttpClient(cfg, session=FakeSession([FakeResponse(payload)])))
        records = list(client.iter_activities(cfg.pathogen("ecoli"), limit=100))
        assert [r["activity_id"] for r in records] == [1]

    def test_pagination_stops_at_the_total(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        page1 = {"activities": [_activity(activity_id=i) for i in range(3)],
                 "page_meta": {"total_count": 3}}
        session = FakeSession([FakeResponse(page1)])
        client = ChemblClient(cfg, http=HttpClient(cfg, session=session))
        records = list(client.iter_activities(cfg.pathogen("ecoli"), limit=100))
        assert len(records) == 3
        assert len(session.calls) == 1

    def test_empty_response_terminates_cleanly(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        session = FakeSession([FakeResponse({"activities": [], "page_meta": {"total_count": 0}})])
        client = ChemblClient(cfg, http=HttpClient(cfg, session=session))
        assert list(client.iter_activities(cfg.pathogen("mrsa"), limit=10)) == []

    def test_approved_molecules_without_structures_are_skipped(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        payload = {
            "molecules": [
                {
                    "molecule_chembl_id": "CHEMBL25", "pref_name": "ASPIRIN",
                    "molecule_structures": {"canonical_smiles": "CC(=O)Oc1ccccc1C(=O)O"},
                    "molecule_synonyms": [{"molecule_synonym": "Aspirin"}],
                },
                {"molecule_chembl_id": "CHEMBL999", "pref_name": "BIOLOGIC",
                 "molecule_structures": None},
            ],
            "page_meta": {"total_count": 2},
        }
        client = ChemblClient(cfg, http=HttpClient(cfg, session=FakeSession([FakeResponse(payload)])))
        molecules = list(client.iter_approved_molecules(limit=10))
        assert [m["chembl_id"] for m in molecules] == ["CHEMBL25"]
        assert molecules[0]["synonyms"] == ["Aspirin"]


class TestOrangeBook:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("AMOXICILLIN TRIHYDRATE", "amoxicillin"),
            # Succinate and phosphate can be esters (hydrocortisone sodium
            # succinate, dexamethasone sodium phosphate), so they are never
            # stripped; the ChEMBL parent resolves true salts instead.
            ("Metoprolol Succinate", "metoprolol succinate"),
            ("CIPROFLOXACIN HYDROCHLORIDE", "ciprofloxacin"),
            ("TRIMETHOPRIM", "trimethoprim"),
            ("Dexamethasone Sodium Phosphate", "dexamethasone sodium phosphate"),
            ("HYDROCORTISONE ACETATE", "hydrocortisone acetate"),
            ("TESTOSTERONE PROPIONATE", "testosterone propionate"),
            ("NICOTINE POLACRILEX", "nicotine"),
            ("SODIUM CHLORIDE", "sodium chloride"),
            ("ibuprofen (micronized)", "ibuprofen"),
            (None, ""),
        ],
    )
    def test_name_normalisation_strips_salts_and_qualifiers(self, raw, expected):
        assert normalize_drug_name(raw) == expected

    def test_combination_products_split_on_semicolons(self):
        assert split_ingredients("AMOXICILLIN; CLAVULANATE POTASSIUM") == [
            "AMOXICILLIN", "CLAVULANATE POTASSIUM"
        ]
        assert split_ingredients(None) == []

    def test_matching_resolves_a_single_ingredient(self):
        index = build_name_index([{"chembl_id": "CHEMBL25", "pref_name": "ASPIRIN", "synonyms": []}])
        product = ApprovedProduct("ASPIRIN", "BAYER", "N012345", "N", "RX", "TABLET", "ORAL", None, "test")
        hit, method = match_product_to_molecule(product, index)
        assert hit["chembl_id"] == "CHEMBL25"
        assert method == "exact_name"

    def test_matching_records_which_component_of_a_combination_matched(self):
        index = build_name_index([{"chembl_id": "CHEMBL1082", "pref_name": "AMOXICILLIN", "synonyms": []}])
        product = ApprovedProduct(
            "CLAVULANATE POTASSIUM; AMOXICILLIN", "AUGMENTIN", "N050564", "N", "RX", "TABLET", "ORAL", None, "test"
        )
        hit, method = match_product_to_molecule(product, index)
        assert hit["chembl_id"] == "CHEMBL1082"
        assert method.startswith("combination_component")

    # ---- the audit's wrong mappings ------------------------------------
    CHEMBL = [
        {"chembl_id": "CHEMBL389621", "pref_name": "HYDROCORTISONE", "synonyms": ["CORTISOL"]},
        {"chembl_id": "CHEMBL1091", "pref_name": "HYDROCORTISONE ACETATE", "synonyms": []},
        {"chembl_id": "CHEMBL386630", "pref_name": "TESTOSTERONE", "synonyms": []},
        {"chembl_id": "CHEMBL1170", "pref_name": "TESTOSTERONE PROPIONATE", "synonyms": []},
        {"chembl_id": "CHEMBL1435", "pref_name": "CEFAZOLIN", "synonyms": []},
        {"chembl_id": "CHEMBL1200843", "pref_name": "CEFAZOLIN SODIUM", "synonyms": []},
        {"chembl_id": "CHEMBL1200458", "pref_name": "POTASSIUM CHLORIDE", "synonyms": []},
        {"chembl_id": "CHEMBL1060", "pref_name": "SODIUM PHOSPHATE, DIBASIC", "synonyms": []},
    ]
    # Structures as the ingest stage resolves them: salts point at their
    # ChEMBL parent; esters are their own parent; inorganic has none.
    STRUCTURE = {
        "CHEMBL389621": "HYDROCORTISONE-KEY", "CHEMBL1091": "HYDROCORTISONE-ACETATE-KEY",
        "CHEMBL386630": "TESTOSTERONE-KEY", "CHEMBL1170": "TESTOSTERONE-PROPIONATE-KEY",
        "CHEMBL1435": "CEFAZOLIN-KEY", "CHEMBL1200843": "CEFAZOLIN-KEY",
        "CHEMBL1200458": None, "CHEMBL1060": None,
    }

    def _match(self, name):
        from src.ingestion.orange_book import match_components
        index = build_name_index(self.CHEMBL)
        product = ApprovedProduct(name, "X", "N1", "N", "RX", None, None, None, "test")
        return match_components(product, index, self.STRUCTURE.get)

    @pytest.mark.parametrize("name, key", [
        ("HYDROCORTISONE", "HYDROCORTISONE-KEY"),
        ("HYDROCORTISONE ACETATE", "HYDROCORTISONE-ACETATE-KEY"),
        ("TESTOSTERONE", "TESTOSTERONE-KEY"),
        ("TESTOSTERONE PROPIONATE", "TESTOSTERONE-PROPIONATE-KEY"),
        ("CEFAZOLIN SODIUM", "CEFAZOLIN-KEY"),
    ])
    def test_each_ingredient_gets_its_own_structure(self, name, key):
        [m] = self._match(name)
        assert self.STRUCTURE[m.molecule["chembl_id"]] == key
        assert m.method == "exact_name"

    def test_the_first_name_seen_no_longer_wins(self):
        # The old index kept whichever molecule claimed "hydrocortisone" first.
        reordered = list(reversed(self.CHEMBL))
        from src.ingestion.orange_book import match_components
        product = ApprovedProduct("HYDROCORTISONE", "X", "N1", "N", "RX", None, None, None, "test")
        [a] = match_components(product, build_name_index(self.CHEMBL), self.STRUCTURE.get)
        [b] = match_components(product, build_name_index(reordered), self.STRUCTURE.get)
        assert a.molecule["chembl_id"] == b.molecule["chembl_id"] == "CHEMBL389621"

    @pytest.mark.parametrize("name", ["SODIUM CHLORIDE", "SODIUM NITROPRUSSIDE", "SODIUM LACTATE", "POTASSIUM CHLORIDE"])
    def test_sodium_prefixed_products_do_not_collapse(self, name):
        [m] = self._match(name)
        assert m.molecule is None, f"{name} must not borrow another substance's structure"

    def test_a_name_meaning_two_structures_is_not_guessed(self):
        from src.ingestion.orange_book import match_components
        index = build_name_index([
            {"chembl_id": "CHEMBL1", "pref_name": "DRUGX", "synonyms": []},
            {"chembl_id": "CHEMBL2", "pref_name": "DRUGX", "synonyms": []},
        ])
        product = ApprovedProduct("DRUGX", "X", "N1", "N", "RX", None, None, None, "test")
        [m] = match_components(product, index, {"CHEMBL1": "A", "CHEMBL2": "B"}.get)
        assert m.molecule is None and m.method == "ambiguous_name"

    def test_every_component_of_a_combination_is_represented(self):
        from src.ingestion.orange_book import product_rows
        index = build_name_index(self.CHEMBL)
        product = ApprovedProduct("HYDROCORTISONE; CEFAZOLIN SODIUM", "X", "N9", "N", "RX", None, None, None, "test")
        rows = list(product_rows([product], index, self.STRUCTURE.get))
        assert [r.generic_name for r in rows] == ["HYDROCORTISONE", "CEFAZOLIN SODIUM"]
        assert [r.drug_id.split("~")[1] for r in rows] == ["1", "2"]
        assert all(r.ingredients == product.generic_name for r in rows)
        assert [self.STRUCTURE[r.chembl_id] for r in rows] == ["HYDROCORTISONE-KEY", "CEFAZOLIN-KEY"]

    def test_no_leading_word_guess(self):
        [m] = self._match("HYDROCORTISONE BUTEPRATE")
        assert m.molecule is None and m.method == "unmatched"

    def test_unmatched_products_are_reported_not_guessed(self):
        index = build_name_index([{"chembl_id": "CHEMBL25", "pref_name": "ASPIRIN", "synonyms": []}])
        product = ApprovedProduct("NOVELCOMPOUND", None, "N1", "N", "RX", None, None, None, "test")
        hit, method = match_product_to_molecule(product, index)
        assert hit is None
        assert method == "unmatched"

    def test_duplicate_products_are_collapsed(self):
        p = ApprovedProduct("ASPIRIN", "BAYER", "N1", "N", "RX", None, None, None, "test")
        assert len(list(iter_unique_products([p, p, p]))) == 1

    def test_zip_parsing_reads_the_tilde_delimited_products_file(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        content = (
            "Ingredient~DF;Route~Trade_Name~Applicant~Strength~Appl_Type~Appl_No~Product_No~"
            "TE_Code~Approval_Date~RLD~RS~Type~Applicant_Full_Name\n"
            "ASPIRIN~TABLET;ORAL~BAYER~BAYER~325MG~N~012345~001~AB~Jan 1, 1982~Yes~Yes~RX~Bayer\n"
        )
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("products.txt", content)
        payload = buffer.getvalue()

        session = FakeSession([FakeResponse(content=payload, headers={"Content-Type": "application/zip"})])
        client = OrangeBookClient(cfg, http=HttpClient(cfg, session=session))
        products = client.fetch_products()

        assert client.source_used == "FDA Orange Book"
        assert len(products) == 1
        assert products[0].generic_name == "ASPIRIN"
        assert products[0].brand_name == "BAYER"
        assert products[0].application_no == "012345"

    def test_non_zip_response_falls_back_to_openfda(self, cfg, monkeypatch):
        """A broken primary source must be reported and replaced, not hidden."""
        monkeypatch.setenv("AMR_OFFLINE", "0")
        openfda_payload = {
            "results": [
                {
                    "application_number": "NDA012345",
                    "products": [
                        {
                            "brand_name": "BAYER", "marketing_status": "Prescription",
                            "dosage_form": "TABLET", "route": "ORAL",
                            "active_ingredients": [{"name": "ASPIRIN"}],
                        }
                    ],
                }
            ]
        }
        session = FakeSession([
            FakeResponse(content=b"<html>404</html>", headers={"Content-Type": "text/html"}),
            FakeResponse(openfda_payload),
            FakeResponse({"results": []}),
        ])
        client = OrangeBookClient(cfg, http=HttpClient(cfg, session=session))
        products = client.fetch_products()
        assert client.source_used == "openFDA Drugs@FDA"
        assert products[0].generic_name == "ASPIRIN"


def _study(nct="NCT00000001", title="A study of vancomycin", conditions=None, phases=None):
    return {
        "protocolSection": {
            "identificationModule": {"nctId": nct, "briefTitle": title},
            "statusModule": {"overallStatus": "COMPLETED",
                             "startDateStruct": {"date": "2010-01"}},
            "designModule": {"studyType": "INTERVENTIONAL", "phases": phases or ["PHASE3"],
                             "enrollmentInfo": {"count": 120}},
            "conditionsModule": {"conditions": conditions or ["Bacterial Infections"]},
            "armsInterventionsModule": {"interventions": [{"name": "Vancomycin"}]},
        }
    }


class TestClinicalTrials:
    def test_study_is_flattened_to_the_displayed_fields(self):
        record = _parse_study(_study())
        assert record.nct_id == "NCT00000001"
        assert record.phase == "PHASE3"
        assert record.study_type == "INTERVENTIONAL"
        assert record.enrollment == 120
        assert record.url.endswith("NCT00000001")

    def test_study_without_an_nct_id_is_discarded(self):
        assert _parse_study({"protocolSection": {"identificationModule": {}}}) is None

    def test_malformed_payload_does_not_raise(self):
        assert _parse_study({}) is None

    def test_infection_context_is_detected_from_the_trial_itself(self, cfg):
        keywords = cfg.get("ingestion", "clinicaltrials", "amr_keywords")
        record = _parse_study(_study(conditions=["MRSA Bacteremia"]))
        related, matched = classify_amr_relevance(record, keywords)
        assert related
        assert "mrsa" in matched

    def test_unrelated_indication_is_not_flagged(self, cfg):
        keywords = cfg.get("ingestion", "clinicaltrials", "amr_keywords")
        record = _parse_study(_study(title="Statin therapy in stroke", conditions=["Stroke"]))
        related, matched = classify_amr_relevance(record, keywords)
        assert not related
        assert matched == []

    def test_intervention_text_alone_does_not_imply_amr_evidence(self, cfg):
        """An antibiotic used as background therapy in an oncology trial is not AMR evidence."""
        keywords = cfg.get("ingestion", "clinicaltrials", "amr_keywords")
        record = TrialRecord(
            nct_id="NCT1", brief_title="Chemotherapy regimen in lymphoma",
            conditions=["Lymphoma"], interventions=["Vancomycin", "Antibiotic resistance panel"],
        )
        related, _ = classify_amr_relevance(record, keywords)
        assert not related

    def test_search_paginates_and_stops_at_the_cap(self, cfg, monkeypatch):
        monkeypatch.setenv("AMR_OFFLINE", "0")
        session = FakeSession([
            FakeResponse({"studies": [_study(f"NCT0000000{i}") for i in range(3)],
                          "nextPageToken": "abc"}),
            FakeResponse({"studies": [_study("NCT10000000")]}),
        ])
        client = ClinicalTrialsClient(cfg, http=HttpClient(cfg, session=session))
        trials = client.search_drug("vancomycin", limit=4)
        assert len(trials) == 4

    def test_blank_query_returns_nothing_without_a_request(self, cfg):
        client = ClinicalTrialsClient(cfg, http=HttpClient(cfg, session=FakeSession([])))
        assert client.search_drug("  ") == []


class TestClinicalQueryTerms:
    """Orange Book ingredient strings have to survive the trip to the registry."""

    def test_combination_brackets_are_removed_not_split_through(self):
        from src.pipeline.clinical import query_term_for

        term = query_term_for("TRISULFAPYRIMIDINES (SULFADIAZINE; SULFAMERAZINE)")
        assert term == "TRISULFAPYRIMIDINES"
        assert "(" not in term and ")" not in term

    def test_first_ingredient_is_used_for_a_plain_combination(self):
        from src.pipeline.clinical import query_term_for

        assert query_term_for("POLYMYXIN B SULFATE; TRIMETHOPRIM") == "POLYMYXIN B SULFATE"

    def test_a_simple_name_is_left_alone(self):
        from src.pipeline.clinical import query_term_for

        assert query_term_for("CIPROFLOXACIN") == "CIPROFLOXACIN"

    def test_a_fully_bracketed_name_still_yields_a_search_term(self):
        from src.pipeline.clinical import query_term_for

        assert query_term_for("(RIFAMPIN)") == "RIFAMPIN"
