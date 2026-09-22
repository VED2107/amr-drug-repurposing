"""SMILES validation, sanitisation, salt stripping and canonicalisation.

Every molecule entering the pipeline goes through :func:`standardize_smiles`.
Failures are returned as a record with ``is_valid=False`` and a human-readable
reason rather than raising, so that one bad structure never aborts a batch.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from rdkit import Chem
from rdkit.Chem import SaltRemover
from rdkit.Chem.Scaffolds import MurckoScaffold


class StandardizationError(ValueError):
    """Raised only by helpers that are documented to raise."""


# RDKit ships a curated salt list; it strips counter-ions such as Cl-, Na+,
# sulfate and mesylate while leaving the parent drug intact.
_SALT_REMOVER = SaltRemover.SaltRemover()



#: Molecules with no ring system share this bucket rather than each becoming its
#: own scaffold, which would defeat the point of a scaffold-aware split.
ACYCLIC_SCAFFOLD = "__acyclic__"


def murcko_scaffold_for(mol) -> str:
    """Bemis-Murcko scaffold as a canonical, **stereochemistry-free** SMILES.

    Stereochemistry is dropped deliberately. A scaffold split exists to keep the
    same chemistry on one side of the partition, and two enantiomers are the same
    chemistry to a fingerprint model. Writing them as different scaffolds would
    let a molecule sit in train while its mirror image scores the test set, which
    inflates the reported metric.

    This is the single definition of a scaffold in the project: ingestion and
    reprocessing both call it, so a molecule cannot end up with a scaffold that
    depends on which stage last touched it.
    """
    try:
        scaffold_mol = MurckoScaffold.GetScaffoldForMol(mol)
        if scaffold_mol is not None and scaffold_mol.GetNumAtoms() > 0:
            scaffold = Chem.MolToSmiles(scaffold_mol, canonical=True, isomericSmiles=False)
            if scaffold:
                return scaffold
    except Exception:
        pass
    return ACYCLIC_SCAFFOLD


@dataclass
class MoleculeRecord:
    """The canonical form of one molecule plus the audit trail of how we got it."""

    input_smiles: str | None
    is_valid: bool
    error: str | None = None
    molecule_id: str | None = None
    canonical_smiles: str | None = None
    inchi: str | None = None
    inchikey: str | None = None
    murcko_scaffold: str | None = None
    heavy_atoms: int | None = None
    salt_stripped: bool = False
    had_multiple_components: bool = False
    mol: Any = field(default=None, repr=False, compare=False)

    def as_row(self) -> dict[str, Any]:
        return {
            "molecule_id": self.molecule_id,
            "input_smiles": self.input_smiles,
            "canonical_smiles": self.canonical_smiles,
            "inchi": self.inchi,
            "inchikey": self.inchikey,
            "murcko_scaffold": self.murcko_scaffold,
            "heavy_atoms": self.heavy_atoms,
            "is_valid": int(self.is_valid),
            "validation_error": self.error,
        }


def molecule_id_for(inchikey: str | None, canonical_smiles: str | None) -> str:
    """Stable primary key for a molecule.

    The standard InChIKey is preferred because it is the community identifier
    for a structure. When InChI generation fails (it does for some exotic
    valences) we fall back to a truncated SHA-256 of the canonical SMILES,
    prefixed so the fallback is always visible in the data.
    """
    if inchikey:
        return inchikey
    if canonical_smiles:
        digest = hashlib.sha256(canonical_smiles.encode("utf-8")).hexdigest()[:27].upper()
        return f"SMI-{digest}"
    raise StandardizationError("cannot build a molecule id without an InChIKey or SMILES")


def _largest_fragment(mol: Chem.Mol) -> Chem.Mol:
    """Return the fragment with the most heavy atoms."""
    frags = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=False)
    if len(frags) <= 1:
        return mol
    return max(frags, key=lambda m: m.GetNumHeavyAtoms())


def standardize_smiles(
    smiles: str | None,
    *,
    strip_salts: bool = True,
    min_heavy_atoms: int = 5,
    max_heavy_atoms: int = 150,
    keep_largest_fragment: bool = True,
) -> MoleculeRecord:
    """Validate and canonicalise one SMILES string.

    The pipeline is:
    parse -> sanitise -> salt strip -> largest fragment -> size check ->
    canonical SMILES -> InChI / InChIKey -> Murcko scaffold.
    """
    if smiles is None or not str(smiles).strip():
        return MoleculeRecord(input_smiles=smiles, is_valid=False, error="missing SMILES")

    raw = str(smiles).strip()

    try:
        mol = Chem.MolFromSmiles(raw, sanitize=False)
    except Exception as exc:  # RDKit can raise on badly malformed input
        return MoleculeRecord(input_smiles=raw, is_valid=False, error=f"parse error: {exc}")

    if mol is None:
        return MoleculeRecord(input_smiles=raw, is_valid=False, error="invalid SMILES: RDKit could not parse")

    try:
        Chem.SanitizeMol(mol)
    except Exception as exc:
        return MoleculeRecord(input_smiles=raw, is_valid=False, error=f"sanitization failed: {exc}")

    had_multi = len(Chem.GetMolFrags(mol)) > 1
    salt_stripped = False

    if strip_salts:
        try:
            stripped = _SALT_REMOVER.StripMol(mol, dontRemoveEverything=True)
            if stripped is not None and stripped.GetNumHeavyAtoms() > 0:
                salt_stripped = stripped.GetNumHeavyAtoms() != mol.GetNumHeavyAtoms()
                mol = stripped
        except Exception as exc:
            return MoleculeRecord(input_smiles=raw, is_valid=False, error=f"salt stripping failed: {exc}")

    if keep_largest_fragment and len(Chem.GetMolFrags(mol)) > 1:
        mol = _largest_fragment(mol)
        try:
            Chem.SanitizeMol(mol)
        except Exception as exc:
            return MoleculeRecord(input_smiles=raw, is_valid=False,
                                  error=f"sanitization failed after fragment selection: {exc}")

    heavy = mol.GetNumHeavyAtoms()
    if heavy < min_heavy_atoms:
        return MoleculeRecord(input_smiles=raw, is_valid=False,
                              error=f"too small after standardization: {heavy} heavy atoms")
    if heavy > max_heavy_atoms:
        return MoleculeRecord(input_smiles=raw, is_valid=False,
                              error=f"too large: {heavy} heavy atoms (limit {max_heavy_atoms})")

    try:
        canonical = Chem.MolToSmiles(mol, canonical=True)
    except Exception as exc:
        return MoleculeRecord(input_smiles=raw, is_valid=False, error=f"canonicalization failed: {exc}")

    inchi: str | None = None
    inchikey: str | None = None
    try:
        inchi = Chem.MolToInchi(mol) or None
        if inchi:
            inchikey = Chem.InchiToInchiKey(inchi) or None
    except Exception:
        # InChI generation genuinely fails for some valid structures. That is a
        # known limitation, not a reason to reject the molecule.
        inchi, inchikey = None, None

    scaffold = murcko_scaffold_for(mol)

    return MoleculeRecord(
        input_smiles=raw,
        is_valid=True,
        molecule_id=molecule_id_for(inchikey, canonical),
        canonical_smiles=canonical,
        inchi=inchi,
        inchikey=inchikey,
        murcko_scaffold=scaffold,
        heavy_atoms=heavy,
        salt_stripped=salt_stripped,
        had_multiple_components=had_multi,
        mol=mol,
    )
