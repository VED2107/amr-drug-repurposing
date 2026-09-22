"""FDA approved-drug ingestion.

Primary source: the official FDA Orange Book data files (EOBZIP), which contain
``products.txt`` - one row per approved drug product with its active
ingredient(s), application number, dosage form/route and marketing status.

Fallback: the openFDA Drugs@FDA API, used when the Orange Book archive cannot
be retrieved. Which source was actually used is recorded on every drug row in
``approval_source`` so the dashboard never overstates provenance.

The Orange Book contains names, not structures. Structures come from ChEMBL by
matching the normalised ingredient name against ChEMBL preferred names and
synonyms; the match method is stored per drug.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Iterable, Iterator

from ..config import Config
from ..logging_utils import get_logger
from .http import HttpClient

log = get_logger("amr.orangebook")

SOURCE_ORANGE_BOOK = "FDA Orange Book"
SOURCE_OPENFDA = "openFDA Drugs@FDA"

# Ingredient strings that describe a combination product; the components are
# split so each active moiety can be matched to a structure independently.
_COMBINATION_SPLIT = re.compile(r"\s*;\s*")

# Salt and hydrate suffixes that are stripped when matching a drug name to a
# ChEMBL molecule. The parent moiety is what carries the structure.
_SALT_SUFFIXES = [
    "hydrochloride", "hydrobromide", "hydroiodide", "sulfate", "sulphate",
    "phosphate", "maleate", "mesylate", "besylate", "tosylate", "citrate",
    "tartrate", "succinate", "fumarate", "acetate", "lactate", "gluconate",
    "nitrate", "bitartrate", "dihydrochloride", "sodium", "potassium",
    "calcium", "magnesium", "chloride", "bromide", "monohydrate",
    "dihydrate", "trihydrate", "anhydrous", "pamoate", "palmitate",
    "stearate", "valerate", "propionate", "dipropionate", "furoate",
    "xinafoate", "embonate", "edisylate", "napsylate", "oxalate",
]


@dataclass
class ApprovedProduct:
    """One approved human drug product."""

    generic_name: str
    brand_name: str | None
    application_no: str | None
    application_type: str | None
    marketing_status: str | None
    dosage_form: str | None
    route: str | None
    approval_date: str | None
    source: str

    @property
    def drug_id(self) -> str:
        appl = self.application_no or "NA"
        brand = (self.brand_name or "NA").upper()
        return f"{self.source[:2].upper()}-{appl}-{brand}"[:120]


def normalize_drug_name(name: str | None) -> str:
    """Lower-case, strip salt/hydrate suffixes and punctuation for matching."""
    if not name:
        return ""
    text = str(name).strip().lower()
    text = re.sub(r"\(.*?\)", " ", text)          # drop parenthetical qualifiers
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Strip trailing salt words, repeatedly: "metoprolol succinate" -> "metoprolol".
    changed = True
    while changed:
        changed = False
        for suffix in _SALT_SUFFIXES:
            if text.endswith(" " + suffix):
                text = text[: -(len(suffix) + 1)].strip()
                changed = True
    return text


def split_ingredients(ingredient_field: str | None) -> list[str]:
    """Split an Orange Book ingredient field into individual active moieties."""
    if not ingredient_field:
        return []
    parts = [p.strip() for p in _COMBINATION_SPLIT.split(str(ingredient_field)) if p.strip()]
    return parts or [str(ingredient_field).strip()]


class OrangeBookClient:
    """Retrieves the approved human drug library from FDA sources."""

    def __init__(self, cfg: Config, http: HttpClient | None = None):
        self.cfg = cfg
        self.http = http or HttpClient(cfg)
        self.ob_cfg = cfg.get("ingestion", "orange_book", default={}) or {}
        self.source_used: str | None = None
        self.source_url: str | None = None
        self.source_version: str | None = None

    # ------------------------------------------------------------- primary --
    def _fetch_orange_book_products(self) -> list[ApprovedProduct]:
        url = self.ob_cfg.get("zip_url")
        products_name = self.ob_cfg.get("products_file", "products.txt")
        resp = self.http.get(
            url, accept="application/zip", user_agent=self.ob_cfg.get("user_agent")
        )
        if not resp.content.startswith(b"PK"):
            raise RuntimeError(
                f"Orange Book URL did not return a zip archive "
                f"(content-type={resp.headers.get('Content-Type')!r}, "
                f"{len(resp.content)} bytes)"
            )

        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            names = zf.namelist()
            match = next((n for n in names if n.lower().endswith(products_name.lower())), None)
            if match is None:
                raise RuntimeError(f"{products_name} not found in Orange Book archive; members: {names}")
            # The Orange Book ships an EXCLUSIVITY/PATENT set alongside; only
            # products.txt is needed here.
            raw = zf.read(match).decode("utf-8", errors="replace")
            info = zf.getinfo(match)
            self.source_version = f"{match} modified {info.date_time[0]:04d}-{info.date_time[1]:02d}-{info.date_time[2]:02d}"

        lines = raw.splitlines()
        if not lines:
            raise RuntimeError("Orange Book products file is empty")

        header = [h.strip() for h in lines[0].split("~")]
        idx = {name: i for i, name in enumerate(header)}
        required = ["Ingredient", "Trade_Name", "Appl_No", "Appl_Type"]
        missing = [c for c in required if c not in idx]
        if missing:
            raise RuntimeError(f"Orange Book products file missing columns {missing}; header={header}")

        def cell(fields: list[str], column: str) -> str | None:
            i = idx.get(column)
            if i is None or i >= len(fields):
                return None
            value = fields[i].strip()
            return value or None

        products: list[ApprovedProduct] = []
        for line in lines[1:]:
            if not line.strip():
                continue
            fields = line.split("~")
            products.append(
                ApprovedProduct(
                    generic_name=cell(fields, "Ingredient") or "",
                    brand_name=cell(fields, "Trade_Name"),
                    application_no=cell(fields, "Appl_No"),
                    application_type=cell(fields, "Appl_Type"),
                    marketing_status=cell(fields, "Type"),
                    dosage_form=cell(fields, "DF;Route"),
                    route=cell(fields, "DF;Route"),
                    approval_date=cell(fields, "Approval_Date"),
                    source=SOURCE_ORANGE_BOOK,
                )
            )

        self.source_used = SOURCE_ORANGE_BOOK
        self.source_url = url
        log.info("Orange Book: %d approved product rows", len(products))
        return products

    # ------------------------------------------------------------ fallback --
    def _fetch_openfda_products(self) -> list[ApprovedProduct]:
        url = self.ob_cfg.get("openfda_url")
        page_size = int(self.ob_cfg.get("openfda_page_size", 1000))
        pages = int(self.ob_cfg.get("openfda_pages", 10))

        products: list[ApprovedProduct] = []
        for page in range(pages):
            payload = self.http.get_json(url, params={"limit": page_size, "skip": page * page_size})
            results = payload.get("results") or []
            if not results:
                break
            for app in results:
                appl_no = app.get("application_number")
                for product in app.get("products") or []:
                    if (product.get("marketing_status") or "").lower() == "discontinued":
                        continue
                    ingredients = product.get("active_ingredients") or []
                    generic = "; ".join(
                        i.get("name", "") for i in ingredients if i.get("name")
                    )
                    if not generic:
                        continue
                    products.append(
                        ApprovedProduct(
                            generic_name=generic,
                            brand_name=product.get("brand_name"),
                            application_no=appl_no,
                            application_type=(app.get("sponsor_name") and None) or None,
                            marketing_status=product.get("marketing_status"),
                            dosage_form=product.get("dosage_form"),
                            route=product.get("route"),
                            approval_date=None,
                            source=SOURCE_OPENFDA,
                        )
                    )
        self.source_used = SOURCE_OPENFDA
        self.source_url = url
        self.source_version = "openFDA live query"
        log.info("openFDA: %d approved product rows", len(products))
        return products

    # ---------------------------------------------------------------- api ---
    def fetch_products(self) -> list[ApprovedProduct]:
        """Fetch approved products, falling back to openFDA on failure.

        A failure of the primary source is logged and recorded, never hidden.
        """
        try:
            return self._fetch_orange_book_products()
        except Exception as exc:
            log.warning("Orange Book retrieval failed (%s: %s); falling back to openFDA",
                        type(exc).__name__, exc)
        return self._fetch_openfda_products()

    def close(self) -> None:
        self.http.close()


def build_name_index(chembl_molecules: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index ChEMBL approved molecules by normalised preferred name and synonyms."""
    index: dict[str, dict[str, Any]] = {}
    for mol in chembl_molecules:
        names = []
        if mol.get("pref_name"):
            names.append(mol["pref_name"])
        names.extend(mol.get("synonyms") or [])
        for name in names:
            key = normalize_drug_name(name)
            if key and key not in index:
                index[key] = mol
    return index


def match_product_to_molecule(
    product: ApprovedProduct, name_index: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any] | None, str]:
    """Map an approved product to a ChEMBL molecule by name.

    Returns (molecule, match_method). Combination products match on their first
    resolvable component, and that is recorded in the match method so the
    dashboard can show that only one moiety was structurally resolved.
    """
    components = split_ingredients(product.generic_name)

    for i, component in enumerate(components):
        key = normalize_drug_name(component)
        if not key:
            continue
        hit = name_index.get(key)
        if hit:
            method = "exact_name" if len(components) == 1 else f"combination_component_{i + 1}"
            return hit, method

    # Single-token fallback: "amoxicillin trihydrate" already normalises, but
    # multi-word brand-style ingredients sometimes need the leading token.
    for component in components:
        key = normalize_drug_name(component)
        first = key.split(" ")[0] if key else ""
        if len(first) >= 5 and first in name_index:
            return name_index[first], "leading_token"

    return None, "unmatched"


def iter_unique_products(products: Iterable[ApprovedProduct]) -> Iterator[ApprovedProduct]:
    """Deduplicate products that share an application number and brand name."""
    seen: set[str] = set()
    for product in products:
        pid = product.drug_id
        if pid in seen:
            continue
        seen.add(pid)
        yield product
