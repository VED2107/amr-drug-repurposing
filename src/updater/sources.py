"""Reading the public sources, through the pipeline's own clients.

Nothing is re-implemented here. :class:`~src.ingestion.chembl.ChemblClient` and
:class:`~src.ingestion.orange_book.OrangeBookClient` are the same objects the
local pipeline uses, with the same rate limiting, the same pagination and the
same configured caps. This module only decides which of the records they return
are *new* to the published database.

A record with no structure is skipped and counted, never completed from another
source or guessed at. "We have no SMILES for this product" is a fact about the
source, and inventing one would put a fabricated molecule into a database whose
whole purpose is that its molecules are real.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..config import Config
from ..ingestion.chembl import ChemblClient
from ..ingestion.http import HttpClient
from ..chemistry.standardize import standardize_smiles
from ..ingestion.orange_book import OrangeBookClient, build_name_index, product_rows
from ..logging_utils import get_logger

log = get_logger("amr.updater.sources")


def _has_carbon(smiles: str | None) -> bool:
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles or "")
    return mol is not None and any(a.GetAtomicNum() == 6 for a in mol.GetAtoms())


@dataclass
class SourceMolecule:
    """One approved structure offered by a source."""

    chembl_id: str | None
    pref_name: str | None
    canonical_smiles: str
    inchi_key: str | None = None


@dataclass
class SourceProduct:
    """One approved product record, and the structure it matched."""

    drug_id: str
    generic_name: str
    brand_name: str | None
    approval_source: str
    application_no: str | None
    application_type: str | None
    marketing_status: str | None
    dosage_form: str | None
    route: str | None
    approval_date: str | None
    #: The ChEMBL parent whose structure this product is screened as.
    chembl_id: str | None
    match_method: str | None
    #: The product's full ingredient field (a combination is one row per component).
    ingredients: str | None = None


@dataclass
class SourceSnapshot:
    """What one sweep of the sources found."""

    molecules: list[SourceMolecule] = field(default_factory=list)
    products: list[SourceProduct] = field(default_factory=list)
    molecules_without_structure: int = 0
    products_unmatched: int = 0
    chembl_url: str | None = None
    orange_book_url: str | None = None
    orange_book_version: str | None = None


def fetch_snapshot(cfg: Config, *, molecule_limit: int | None = None) -> SourceSnapshot:
    """Read the approved-drug sources once.

    The full source is read rather than a delta, because neither source offers a
    reliable "changed since" cursor. Deciding what is new happens against the
    published database, which is the only record that actually knows.
    """
    snapshot = SourceSnapshot()

    http = HttpClient(cfg)
    chembl = ChemblClient(cfg, http=HttpClient(cfg))
    orange_book = OrangeBookClient(cfg, http=http)

    try:
        log.info("[AMR UPDATE] Checking sources...")

        approved = list(chembl.iter_approved_molecules(limit=molecule_limit))
        for mol in approved:
            smiles = (mol.get("canonical_smiles") or "").strip()
            if not smiles:
                # Counted, not filled in.
                snapshot.molecules_without_structure += 1
                continue
            snapshot.molecules.append(
                SourceMolecule(
                    chembl_id=mol.get("chembl_id"),
                    pref_name=mol.get("pref_name"),
                    canonical_smiles=smiles,
                    inchi_key=mol.get("inchi_key"),
                )
            )
        snapshot.chembl_url = cfg.get("ingestion", "chembl", "base_url")
        log.info(
            "[AMR UPDATE] ChEMBL: %d approved molecules with a structure, %d without",
            len(snapshot.molecules), snapshot.molecules_without_structure,
        )

        name_index = build_name_index(approved)
        products = orange_book.fetch_products()

        # The same matching as the pipeline's ingest stage: a product's structure
        # is its ChEMBL parent (the curated active moiety), a name that points at
        # disagreeing structures is not guessed, inorganic substances get none,
        # and a combination product yields one row per active ingredient.
        by_id = {m["chembl_id"]: m for m in approved}
        parent_of = {m["chembl_id"]: m.get("parent_chembl_id") or m["chembl_id"] for m in approved}
        std_cfg = cfg.get("chemistry", "standardization", default={}) or {}
        cache: dict[str, str | None] = {}

        def resolve(chembl_id: str) -> str | None:
            parent = parent_of.get(chembl_id, chembl_id)
            if parent not in cache:
                mol = by_id.get(parent)
                record = standardize_smiles(
                    mol["canonical_smiles"],
                    strip_salts=bool(std_cfg.get("strip_salts", True)),
                    min_heavy_atoms=int(std_cfg.get("min_heavy_atoms", 5)),
                    max_heavy_atoms=int(std_cfg.get("max_heavy_atoms", 150)),
                ) if mol and mol.get("canonical_smiles") else None
                ok = record is not None and record.is_valid and _has_carbon(record.canonical_smiles)
                cache[parent] = record.molecule_id if ok else None
            return cache[parent]

        for row in product_rows(products, name_index, resolve):
            product = row.product
            parent = parent_of.get(row.chembl_id, row.chembl_id) if row.chembl_id else None
            if parent is None:
                snapshot.products_unmatched += 1
            snapshot.products.append(
                SourceProduct(
                    drug_id=row.drug_id,
                    generic_name=row.generic_name,
                    brand_name=product.brand_name,
                    approval_source=product.source,
                    application_no=product.application_no,
                    application_type=product.application_type,
                    marketing_status=product.marketing_status,
                    dosage_form=product.dosage_form,
                    route=product.route,
                    approval_date=product.approval_date,
                    chembl_id=parent,
                    match_method=row.match_method,
                    ingredients=row.ingredients,
                )
            )

        snapshot.orange_book_url = orange_book.source_url
        snapshot.orange_book_version = orange_book.source_version
        log.info(
            "[AMR UPDATE] FDA: %d approved products, %d without a matched structure",
            len(snapshot.products), snapshot.products_unmatched,
        )
    finally:
        orange_book.close()
        chembl.close()

    return snapshot
