"""FDA approved-drug ingestion.

Primary source: the official FDA Orange Book data files (EOBZIP), which contain
``products.txt`` - one row per approved drug product with its active
ingredient(s), application number, dosage form/route and marketing status.

Fallback: the openFDA Drugs@FDA API, used when the Orange Book archive cannot
be retrieved. Which source was actually used is recorded on every drug row in
``approval_source`` so the dashboard never overstates provenance.

The Orange Book contains names, not structures. Structures come from ChEMBL by
matching each active ingredient's name against ChEMBL preferred names and
synonyms — exactly first, then without counter-ions — and a name that points at
disagreeing structures is left unmatched rather than guessed. The match method
is stored per product row.
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

# Counter-ions and water of hydration: words whose removal never changes the
# active moiety, because standardisation strips them from the structure too.
# Ester-forming acids are deliberately absent (acetate, propionate, valerate,
# succinate, phosphate, palmitate, butyrate, furoate, ...): hydrocortisone
# acetate and testosterone propionate are different molecules from hydrocortisone
# and testosterone, and "phosphate" / "succinate" are esters in
# dexamethasone sodium phosphate and hydrocortisone sodium succinate.
_COUNTER_IONS = [
    "hydrochloride", "dihydrochloride", "hydrobromide", "hydroiodide",
    "sulfate", "sulphate", "bisulfate", "mesylate", "dimesylate", "besylate",
    "besilate", "tosylate", "maleate", "fumarate", "hemifumarate", "tartrate",
    "bitartrate", "d-tartrate", "l-tartrate", "citrate", "hyclate", "napsylate",
    "edisylate", "pamoate", "embonate", "oxalate", "nitrate", "tannate",
    "polistirex", "polacrilex", "polygalacturonate", "sodium", "disodium", "trisodium", "potassium",
    "dipotassium", "calcium", "magnesium", "meglumine", "tromethamine", "choline",
    "hydrate", "monohydrate", "dihydrate", "trihydrate", "sesquihydrate",
    "hemihydrate", "pentahydrate", "heptahydrate", "anhydrous",
]

# Kept for importers: the old name of the list.
_SALT_SUFFIXES = _COUNTER_IONS


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


def exact_name_key(name: str | None) -> str:
    """An ingredient name for exact comparison: case, punctuation and
    parenthetical qualifiers aside, nothing removed."""
    if not name:
        return ""
    text = str(name).strip().lower()
    text = re.sub(r"\(.*?\)", " ", text)          # drop parenthetical qualifiers
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_drug_name(name: str | None) -> str:
    """The name without trailing counter-ions or water of hydration.

    "ciprofloxacin hydrochloride" → "ciprofloxacin"; "hydrocortisone acetate"
    stays as it is, because acetate is an ester there, not a salt. A name that
    would be left empty or as a bare ion ("sodium chloride") is returned whole.
    """
    text = exact_name_key(name)
    if not text:
        return ""
    changed = True
    while changed:
        changed = False
        for suffix in _COUNTER_IONS:
            if text.endswith(" " + suffix):
                stripped = text[: -(len(suffix) + 1)].strip()
                if stripped and stripped not in _COUNTER_IONS:
                    text = stripped
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


def build_name_index(chembl_molecules: Iterable[dict[str, Any]]) -> "NameIndex":
    """Index ChEMBL approved molecules by name, keeping every molecule per name.

    Nothing is dropped when two molecules share a name: the old index kept the
    first molecule seen, so "hydrocortisone" meant whichever hydrocortisone
    ester ChEMBL happened to list first. Here a name keeps all its molecules and
    the matcher decides, by structure, whether they agree.
    """
    index = NameIndex()
    for mol in chembl_molecules:
        if mol.get("pref_name"):
            index.add(mol["pref_name"], mol, preferred=True)
        for name in mol.get("synonyms") or []:
            index.add(name, mol, preferred=False)
    return index


@dataclass
class NameIndex:
    """Exact names and counter-ion-free names → the ChEMBL molecules carrying them."""

    exact: dict[str, list[tuple[bool, dict[str, Any]]]] = None  # type: ignore[assignment]
    counter_ion_free: dict[str, list[tuple[bool, dict[str, Any]]]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.exact = {}
        self.counter_ion_free = {}

    def add(self, name: str, mol: dict[str, Any], *, preferred: bool) -> None:
        for table, key in ((self.exact, exact_name_key(name)), (self.counter_ion_free, normalize_drug_name(name))):
            if not key:
                continue
            entries = table.setdefault(key, [])
            if not any(m is mol and p == preferred for p, m in entries):
                entries.append((preferred, mol))

    def __len__(self) -> int:
        return len(self.exact)


@dataclass
class ComponentMatch:
    """One active ingredient of a product and the structure it resolved to."""

    component: str
    #: The ChEMBL molecule chosen, or None when no structure is reliable.
    molecule: dict[str, Any] | None
    #: exact_name | counter_ion | ambiguous_name | unmatched, prefixed with
    #: ``combination_component_<n>_`` for a component of a combination product.
    method: str


def _choose(
    entries: list[tuple[bool, dict[str, Any]]], resolve: "Resolver"
) -> tuple[dict[str, Any] | None, bool]:
    """Pick the molecule a name denotes, or report that it is ambiguous.

    Preferred names outrank synonyms. Several molecules at the best rank are
    accepted only when they all standardise to one structure (they are the same
    active ingredient filed twice); otherwise the name is ambiguous and no
    structure is assigned. The choice among agreeing records is the lowest
    ChEMBL id, so it never depends on the order ChEMBL returned them in.
    """
    for rank in (True, False):
        tier = [m for p, m in entries if p is rank]
        if not tier:
            continue
        structures = {resolve(m["chembl_id"]) for m in tier}
        structures.discard(None)
        if len(structures) > 1:
            return None, True
        if not structures:
            continue
        chosen = sorted(
            (m for m in tier if resolve(m["chembl_id"]) is not None),
            key=lambda m: (len(m["chembl_id"]), m["chembl_id"]),
        )[0]
        return chosen, False
    return None, False


#: Given a ChEMBL id, the standardised structure id it becomes (or None when its
#: structure fails standardisation).
Resolver = Any


def match_components(
    product: ApprovedProduct, name_index: NameIndex, resolve: Resolver
) -> list[ComponentMatch]:
    """Map every active ingredient of a product to a structure, deterministically.

    1. Exact ingredient name (case, punctuation and qualifiers aside).
    2. The same name without counter-ions or water of hydration
       ("metoprolol succinate" is not stripped — succinate can be an ester —
       but "ciprofloxacin hydrochloride" → "ciprofloxacin").
    3. Nothing else. No leading-word or fuzzy guess: a product that neither
       step resolves, or that resolves to disagreeing structures, is recorded
       as unmatched or ambiguous — "structure not reliably matched".

    A combination product yields one match per component, so each active
    ingredient is represented rather than whichever happened to come first.
    """
    components = split_ingredients(product.generic_name)
    out: list[ComponentMatch] = []
    for i, component in enumerate(components):
        prefix = f"combination_component_{i + 1}_" if len(components) > 1 else ""
        molecule = None
        method = "unmatched"
        for table, label in ((name_index.exact, "exact_name"), (name_index.counter_ion_free, "counter_ion")):
            key = exact_name_key(component) if label == "exact_name" else normalize_drug_name(component)
            entries = table.get(key) if key else None
            if not entries:
                continue
            chosen, ambiguous = _choose(entries, resolve)
            if ambiguous:
                method = "ambiguous_name"
                break
            if chosen is not None:
                molecule, method = chosen, label
                break
        out.append(ComponentMatch(component=component, molecule=molecule, method=prefix + method))
    return out


def match_product_to_molecule(
    product: ApprovedProduct, name_index: NameIndex, resolve: Resolver | None = None
) -> tuple[dict[str, Any] | None, str]:
    """A single-ingredient product's structure, or the first component's.

    Kept for callers that need one answer per product; the ingestion stages use
    :func:`match_components`.
    """
    resolve = resolve or (lambda chembl_id: chembl_id)
    matches = match_components(product, name_index, resolve)
    for m in matches:
        if m.molecule is not None:
            return m.molecule, m.method
    if any(m.method.endswith("ambiguous_name") for m in matches):
        return None, "ambiguous_name"
    return None, "unmatched"


@dataclass
class ProductRow:
    """One row of the ``drugs`` table: an approved product, or one active
    ingredient of a combination product."""

    drug_id: str
    #: The ingredient this row stands for (the whole ingredient field for a
    #: single-ingredient product, one component for a combination).
    generic_name: str
    #: The product's full Orange Book ingredient field.
    ingredients: str
    product: ApprovedProduct
    chembl_id: str | None
    match_method: str


def product_rows(
    products: Iterable[ApprovedProduct], name_index: NameIndex, resolve: Resolver
) -> Iterator[ProductRow]:
    """Every unique product as ``drugs`` rows, one per active ingredient.

    A single-ingredient product keeps its own id. A combination product becomes
    one row per component, ``<product id>~<n>``, so every active ingredient is
    represented, each with its own structure or its own "not reliably matched".
    """
    for product in iter_unique_products(products):
        matches = match_components(product, name_index, resolve)
        single = len(matches) <= 1
        if not matches:
            yield ProductRow(product.drug_id, product.generic_name, product.generic_name,
                             product, None, "unmatched")
            continue
        for i, m in enumerate(matches):
            yield ProductRow(
                drug_id=product.drug_id if single else f"{product.drug_id}~{i + 1}"[:128],
                generic_name=product.generic_name if single else m.component,
                ingredients=product.generic_name,
                product=product,
                chembl_id=m.molecule["chembl_id"] if m.molecule else None,
                match_method=m.method,
            )


def iter_unique_products(products: Iterable[ApprovedProduct]) -> Iterator[ApprovedProduct]:
    """Deduplicate products that share an application number and brand name."""
    seen: set[str] = set()
    for product in products:
        pid = product.drug_id
        if pid in seen:
            continue
        seen.add(pid)
        yield product
