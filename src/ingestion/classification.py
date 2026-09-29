"""What an approved medicine is already used for, and whether it is already an
anti-infective.

The repurposing view hides medicines that are already antibacterial drugs, so
the decision "this medicine is already an antibacterial" has to come from a
published classification, never from how its name sounds. Three sources are
read, all public and all traceable:

* **WHO ATC codes**, as ChEMBL records them for the molecule and for its parent
  (salt forms often carry no code of their own). ATC is the WHO's therapeutic
  classification; ``J01`` is "antibacterials for systemic use".
* **FDA Established Pharmacologic Class** (EPC), from the openFDA label of an
  approved product. Only labels with exactly one active substance are used,
  because a combination label lists the classes of every ingredient and would
  make, for example, a corticosteroid look like an antibacterial.
* **Approved indications** from ChEMBL (``max_phase_for_ind = 4``). These are
  what the reader sees as the medicine's existing use; they are not used to
  classify it.

The rule itself is :func:`classify`. It is deliberately short, so the website
and the report can quote it exactly (``RULE_TEXT``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Sequence

from ..config import Config
from ..logging_utils import get_logger
from .http import HttpClient

log = get_logger("amr.classification")

#: Bumped whenever the rule below changes, so a stored status says which rule
#: produced it.
RULE_VERSION = "anti-infective-rule-v5"

# ----------------------------------------------------------------- statuses --
ANTIBACTERIAL = "antibacterial"
OTHER_ANTI_INFECTIVE = "other_anti_infective"
NOT_ANTI_INFECTIVE = "not_anti_infective"
UNCLASSIFIED = "unclassified"

STATUSES = (ANTIBACTERIAL, OTHER_ANTI_INFECTIVE, NOT_ANTI_INFECTIVE, UNCLASSIFIED)

# ------------------------------------------------------------- ATC groups ---
#: ATC groups whose every member is an antibacterial or antimycobacterial.
ANTIBACTERIAL_ATC: dict[str, str] = {
    "J01": "Antibacterials for systemic use",
    "J04": "Antimycobacterials",
    "D06BA": "Sulfonamides (dermatological)",
    "D10AF": "Anti-infectives for treatment of acne",
    "S01AB": "Sulfonamides (ophthalmological)",
    "S01AE": "Fluoroquinolones (ophthalmological)",
}

#: ATC "antibiotics" groups. Nearly all members are antibacterials, but the
#: WHO also files polyene antifungals here (nystatin, natamycin, amphotericin B
#: sit in A07AA, G01AA and S01AA). A code here counts as antibacterial only when
#: nothing classes the same medicine as an antifungal.
ANTIBIOTIC_ATC: dict[str, str] = {
    "A07AA": "Intestinal antibiotics",
    "D06A": "Antibiotics for topical use",
    "S01AA": "Ophthalmic antibiotics",
    "G01AA": "Gynecological antibiotics",
    "R02AB": "Throat antibiotics",
}

#: Groups that mark a medicine as an antifungal.
ANTIFUNGAL_ATC: dict[str, str] = {
    "J02": "Antimycotics for systemic use",
    "D01": "Antifungals for dermatological use",
    "G01AF": "Imidazole derivatives (gynecological)",
    "G01AG": "Triazole derivatives (gynecological)",
}

#: ATC groups for anti-infectives that are not antibacterials: antifungals,
#: antivirals, antiparasitics and antiseptics, or mixed anti-infective groups
#: (e.g. S02AA "otological anti-infectives" also holds antifungals).
OTHER_ANTI_INFECTIVE_ATC: dict[str, str] = {
    **ANTIFUNGAL_ATC,
    **ANTIBIOTIC_ATC,
    "J05": "Antivirals for systemic use",
    "P01": "Antiprotozoals",
    "P02": "Anthelmintics",
    "P03": "Ectoparasiticides",
    "D06B": "Chemotherapeutics for topical use",
    "D08": "Antiseptics and disinfectants",
    "D09AA": "Medicated dressings with anti-infectives",
    "G01": "Gynecological anti-infectives and antiseptics",
    "S01A": "Ophthalmic anti-infectives",
    "S02A": "Otological anti-infectives",
    "S03A": "Ophthalmological and otological anti-infectives",
    "A07A": "Intestinal anti-infectives",
    "A01AB": "Local oral anti-infectives",
}

# ------------------------------------------------------------- FDA classes --
#: FDA Established Pharmacologic Classes that mark an antibacterial: any class
#: naming itself antibacterial or antimycobacterial, plus two the FDA names
#: otherwise — "Tetracycline-class Drug" and "Quinolone Antimicrobial".
ANTIBACTERIAL_EPC_WORDS = (
    "antibacterial", "antimycobacterial", "tetracycline-class drug", "quinolone antimicrobial",
)

#: Classes that mark an antifungal.
ANTIFUNGAL_EPC_WORDS = ("antifungal", "polyene")

#: Classes that mark another kind of anti-infective.
OTHER_ANTI_INFECTIVE_EPC_WORDS = ANTIFUNGAL_EPC_WORDS + (
    "antiviral", "antiprotozoal", "antimalarial", "anthelmintic", "antiseptic",
    "pediculicide", "scabicide", "antiretroviral", "neuraminidase inhibitor", "hiv ",
    "hepatitis c", "hepatitis b", "antitrichomonal", "amebicide", "antiparasitic",
)

#: WHO ATC codes for approved antibacterial ingredients that ChEMBL files with
#: no ATC code at all, keyed by ChEMBL id. Only ingredients whose WHO code is
#: unambiguous are listed; most exist in WHO ATC only as part of a combination
#: code (a beta-lactamase inhibitor is always given with a beta-lactam). Used
#: only when ChEMBL supplies no code for the medicine. Source: WHO ATC/DDD index
#: (https://atcddd.fhi.no/atc_ddd_index/).
EXPLICIT_ATC: dict[str, tuple[str, str]] = {
    "CHEMBL777": ("J01CR02", "clavulanic acid: amoxicillin and beta-lactamase inhibitor"),
    "CHEMBL1689063": ("J01DD52", "avibactam: ceftazidime and beta-lactamase inhibitor"),
    "CHEMBL1213250": ("J01DI54", "ceftolozane: ceftolozane and beta-lactamase inhibitor"),
    "CHEMBL3112741": ("J01DH56", "relebactam: imipenem, cilastatin and relebactam"),
    "CHEMBL3317857": ("J01DH52", "vaborbactam: meropenem and vaborbactam"),
    "CHEMBL148": ("J01DH51", "imipenem: imipenem and cilastatin"),
    "CHEMBL1200649": ("J01FG02", "quinupristin: quinupristin/dalfopristin"),
    "CHEMBL1200937": ("J01FG02", "dalfopristin: quinupristin/dalfopristin"),
    "CHEMBL2218877": ("J01FA01", "erythromycin estolate: erythromycin"),
}

RULE_TEXT = (
    "A medicine is an existing antibacterial when (a) any WHO ATC code recorded for it "
    "in ChEMBL (on the molecule, its parent, its salt and hydrate forms, or the active "
    "moiety ChEMBL records for a prodrug, e.g. cefuroxime for cefuroxime axetil) falls in "
    "J01, J04, D06BA, D10AF, S01AB or S01AE; or (b) a code falls in the ATC antibiotic "
    "groups A07AA, D06A, S01AA, G01AA or R02AB and nothing classes it as an antifungal "
    "(ATC J02, D01, G01AF, G01AG, or an FDA antifungal or polyene class), because the WHO "
    "files polyene antifungals in those groups; or (c) the FDA Established Pharmacologic "
    "Class on a single-ingredient FDA label names it antibacterial or antimycobacterial, "
    "or is the tetracycline or quinolone antimicrobial class (labels are read by the "
    "medicine's FDA application numbers, and, when none has a class, by its exact active "
    "substance). It is another anti-infective (antifungal, antiviral, "
    "antiparasitic, antiseptic) when a code falls in J02, J05, P01, P02, P03, D01, D06B, "
    "D08, D09AA, G01, S01A, S02A, S03A, A07A or A01AB, or its FDA class says so. It is not "
    "an anti-infective when it has at least one ATC code or FDA class and none of these. "
    "Where ChEMBL records no ATC code, a short list of WHO ATC codes for named "
    "antibacterial ingredients (EXPLICIT_ATC) is used. With no ATC code and no "
    "single-ingredient FDA class it is unclassified: kept in the library and marked "
    "for review, never removed, and never counted as a non-antibacterial candidate."
)


def is_antibacterial(status: str) -> str:
    """The status as the three-valued flag: 'true', 'false' or 'unclassified'.

    Unclassified is never read as false.
    """
    if status == ANTIBACTERIAL:
        return "true"
    if status in (OTHER_ANTI_INFECTIVE, NOT_ANTI_INFECTIVE):
        return "false"
    return "unclassified"


def _atc_group(code: str, groups: dict[str, str]) -> str | None:
    for prefix in sorted(groups, key=len, reverse=True):
        if code.upper().startswith(prefix):
            return prefix
    return None


def _epc_has(value: str, words: tuple[str, ...]) -> bool:
    text = f"{value.lower()} "
    return any(w in text for w in words)


@dataclass
class Classification:
    status: str
    #: Every code or class that decided the status, e.g. ``["WHO ATC J01MA02"]``.
    basis: list[str] = field(default_factory=list)


def classify(atc_codes: Iterable[str], fda_classes: Iterable[str]) -> Classification:
    """Apply the documented rule. Pure: no network, no database."""
    atc = sorted({c.strip().upper() for c in atc_codes if c and c.strip()})
    epc = sorted({c.strip() for c in fda_classes if c and c.strip()})

    antifungal = any(_atc_group(c, ANTIFUNGAL_ATC) for c in atc) or any(
        _epc_has(c, ANTIFUNGAL_EPC_WORDS) for c in epc
    )

    antibacterial = [f"WHO ATC {c}" for c in atc if _atc_group(c, ANTIBACTERIAL_ATC)]
    if not antifungal:
        antibacterial += [f"WHO ATC {c}" for c in atc if _atc_group(c, ANTIBIOTIC_ATC)]
    antibacterial += [f"FDA class {c}" for c in epc if _epc_has(c, ANTIBACTERIAL_EPC_WORDS)]
    if antibacterial:
        return Classification(ANTIBACTERIAL, antibacterial)

    other = [f"WHO ATC {c}" for c in atc if _atc_group(c, OTHER_ANTI_INFECTIVE_ATC)]
    other += [f"FDA class {c}" for c in epc if _epc_has(c, OTHER_ANTI_INFECTIVE_EPC_WORDS)]
    if other:
        return Classification(OTHER_ANTI_INFECTIVE, other)

    if atc or epc:
        return Classification(
            NOT_ANTI_INFECTIVE, [f"WHO ATC {c}" for c in atc] + [f"FDA class {c}" for c in epc]
        )
    return Classification(UNCLASSIFIED, [])


# --------------------------------------------------------------- fetching ---
def _chunks(items: Sequence[str], size: int) -> Iterator[Sequence[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


class ClassificationClient:
    """Reads ATC codes and approved indications from ChEMBL, FDA classes from openFDA."""

    OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"

    def __init__(self, cfg: Config, http: HttpClient | None = None, *, label_cache: Any = None):
        self.base = cfg.get("ingestion", "chembl", "base_url").rstrip("/")
        self.http = http or HttpClient(cfg)
        #: Optional JSON file of label facts already read from openFDA, so a
        #: re-run asks only for applications it has not seen (openFDA allows
        #: about 1,000 requests a day without a key).
        self.label_cache = label_cache
        self.unread_applications: list[str] = []

    # ----------------------------------------------------------- ChEMBL ----
    def molecules(self, chembl_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        """ATC codes and parent id per ChEMBL molecule."""
        out: dict[str, dict[str, Any]] = {}
        for chunk in _chunks(sorted(set(chembl_ids)), 50):
            payload = self.http.get_json(
                f"{self.base}/molecule.json",
                params={
                    "molecule_chembl_id__in": ",".join(chunk),
                    "limit": len(chunk),
                    "only": "molecule_chembl_id,atc_classifications,molecule_hierarchy",
                },
            )
            for m in payload.get("molecules") or []:
                hierarchy = m.get("molecule_hierarchy") or {}
                out[m["molecule_chembl_id"]] = {
                    "atc": list(m.get("atc_classifications") or []),
                    "parent": hierarchy.get("parent_chembl_id"),
                        # The pharmacologically active moiety: for a prodrug
                        # (cefuroxime axetil) this is the drug it releases.
                        "active": hierarchy.get("active_chembl_id"),
                }
        return out

    def child_forms(self, parent_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        """Salt and hydrate forms filed under these parents, with their ATC codes.

        ChEMBL often records a medicine's ATC code on the form that is marketed
        (doxycycline hyclate, levofloxacin hemihydrate) rather than on the parent.
        """
        out: dict[str, dict[str, Any]] = {}
        for chunk in _chunks(sorted(set(parent_ids)), 40):
            offset = 0
            while True:
                payload = self.http.get_json(
                    f"{self.base}/molecule.json",
                    params={
                        "molecule_hierarchy__parent_chembl_id__in": ",".join(chunk),
                        "limit": 1000,
                        "offset": offset,
                        "only": "molecule_chembl_id,atc_classifications,molecule_hierarchy",
                    },
                )
                rows = payload.get("molecules") or []
                for m in rows:
                    hierarchy = m.get("molecule_hierarchy") or {}
                    out[m["molecule_chembl_id"]] = {
                        "atc": list(m.get("atc_classifications") or []),
                        "parent": hierarchy.get("parent_chembl_id"),
                        # The pharmacologically active moiety: for a prodrug
                        # (cefuroxime axetil) this is the drug it releases.
                        "active": hierarchy.get("active_chembl_id"),
                    }
                if not rows or not (payload.get("page_meta") or {}).get("next"):
                    break
                offset += len(rows)
        return out

    def atc_names(self) -> dict[str, dict[str, str]]:
        """The whole ATC tree ChEMBL holds, keyed by level-5 code."""
        out: dict[str, dict[str, str]] = {}
        offset = 0
        while True:
            payload = self.http.get_json(
                f"{self.base}/atc_class.json", params={"limit": 1000, "offset": offset}
            )
            rows = payload.get("atc") or []
            for r in rows:
                out[r["level5"]] = {
                    "name": r.get("who_name") or "",
                    "level2": r.get("level2_description") or "",
                    "level3": r.get("level3_description") or "",
                    "level4": r.get("level4_description") or "",
                }
            if not rows or not (payload.get("page_meta") or {}).get("next"):
                break
            offset += len(rows)
        return out

    def approved_indications(self, chembl_ids: Sequence[str]) -> list[dict[str, Any]]:
        """Indications ChEMBL records at phase 4 (approved) for these molecules."""
        out: list[dict[str, Any]] = []
        for chunk in _chunks(sorted(set(chembl_ids)), 40):
            offset = 0
            while True:
                payload = self.http.get_json(
                    f"{self.base}/drug_indication.json",
                    params={
                        "molecule_chembl_id__in": ",".join(chunk),
                        "max_phase_for_ind": 4,
                        "limit": 1000,
                        "offset": offset,
                    },
                )
                rows = payload.get("drug_indications") or []
                for r in rows:
                    refs = r.get("indication_refs") or []
                    label_ref = next(
                        (x for x in refs if x.get("ref_type") in ("DailyMed", "FDA")), None
                    )
                    out.append({
                        "chembl_id": r.get("molecule_chembl_id") or r.get("parent_molecule_chembl_id"),
                        "indication": r.get("efo_term") or r.get("mesh_heading"),
                        "mesh_heading": r.get("mesh_heading"),
                        "ref_type": label_ref.get("ref_type") if label_ref else None,
                        "ref_url": label_ref.get("ref_url") if label_ref else None,
                    })
                if not rows or not (payload.get("page_meta") or {}).get("next"):
                    break
                offset += len(rows)
        return out

    # ----------------------------------------------------------- openFDA ---
    def fda_labels(self, application_numbers: Sequence[str]) -> dict[str, dict[str, Any]]:
        """Single-ingredient label facts per application number (``NDA012345``).

        A label with several active substances is recorded with no classes: its
        classes belong to the combination, not to any one ingredient.

        openFDA sometimes answers a batch with a server error. The batch is then
        split and retried in halves, down to single applications; one that still
        fails is listed in ``self.unread_applications`` rather than aborting the
        run, and its medicine is classified from its other sources.
        """
        import json
        from pathlib import Path

        cached: dict[str, Any] = {}
        cache = Path(self.label_cache) if self.label_cache else None
        if cache and cache.exists():
            cached = json.loads(cache.read_text(encoding="utf8"))
        out: dict[str, dict[str, Any]] = {
            app: {"classes": set(v["classes"]), "set_id": v["set_id"], "single": v["single"]}
            for app, v in cached.get("labels", {}).items()
        }
        seen = set(cached.get("seen", []))
        wanted = sorted(set(application_numbers) - seen)
        log.info("openFDA: %d applications cached, %d to read", len(set(application_numbers)) - len(wanted), len(wanted))
        self.unread_applications = []
        for chunk in _chunks(wanted, 40):
            self._read_labels(list(chunk), out)
        seen |= set(wanted) - set(self.unread_applications)
        if cache:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({
                "seen": sorted(seen),
                "labels": {
                    app: {"classes": sorted(v["classes"]), "set_id": v["set_id"], "single": v["single"]}
                    for app, v in sorted(out.items())
                },
            }), encoding="utf8")
        return out

    def fda_classes_by_substance(self, substances: Sequence[str]) -> dict[str, dict[str, Any]]:
        """Pharmacologic classes from single-ingredient labels, by exact substance.

        Keyed by the upper-cased substance name as openFDA records it. A label
        naming several substances is ignored, as in :meth:`fda_labels`.
        """
        out: dict[str, dict[str, Any]] = {}
        names = sorted({s.strip().upper() for s in substances if s and s.strip() and '"' not in s})
        for chunk in _chunks(names, 20):
            search = "openfda.substance_name:(" + " ".join(f'"{n}"' for n in chunk) + ")"
            try:
                payload = self.http.get_json(
                    self.OPENFDA_LABEL_URL, params={"search": search, "limit": 1000}
                )
            except RuntimeError as exc:
                if "404" not in str(exc):
                    log.warning("openFDA substance lookup failed for %d names: %s", len(chunk), exc)
                continue
            for r in payload.get("results") or []:
                o = r.get("openfda") or {}
                subs = o.get("substance_name") or []
                classes = o.get("pharm_class_epc") or []
                if len(subs) != 1 or not classes:
                    continue
                key = subs[0].strip().upper()
                if key not in chunk:
                    continue
                entry = out.setdefault(key, {"classes": set(), "set_id": r.get("set_id")})
                entry["classes"].update(classes)
        return out

    def _read_labels(self, apps: list[str], out: dict[str, dict[str, Any]]) -> None:
        search = "openfda.application_number:(" + " ".join(apps) + ")"
        skip = 0
        while True:
            try:
                payload = self.http.get_json(
                    self.OPENFDA_LABEL_URL, params={"search": search, "limit": 1000, "skip": skip}
                )
            except RuntimeError as exc:
                # openFDA answers 404 when nothing matches the search.
                if "404" in str(exc):
                    return
                if len(apps) > 1:
                    half = len(apps) // 2
                    self._read_labels(apps[:half], out)
                    self._read_labels(apps[half:], out)
                else:
                    log.warning("openFDA label for %s could not be read: %s", apps[0], exc)
                    self.unread_applications.extend(apps)
                return
            rows = payload.get("results") or []
            for r in rows:
                o = r.get("openfda") or {}
                substances = o.get("substance_name") or []
                for app in o.get("application_number") or []:
                    entry = out.setdefault(app, {"classes": set(), "set_id": None, "single": False})
                    if len(substances) == 1:
                        entry["single"] = True
                        entry["classes"].update(o.get("pharm_class_epc") or [])
                        entry["set_id"] = entry["set_id"] or r.get("set_id")
            total = ((payload.get("meta") or {}).get("results") or {}).get("total", 0)
            skip += len(rows)
            if not rows or skip >= total:
                return


def strip_epc_suffix(value: str) -> str:
    """``"Corticosteroid [EPC]"`` → ``"Corticosteroid"``."""
    return value.replace("[EPC]", "").strip()
