"""2D structure depiction for the dashboard."""

from __future__ import annotations

from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D


def mol_to_svg(
    smiles: str | None,
    *,
    width: int = 420,
    height: int = 300,
    dark: bool = False,
) -> str | None:
    """Render a canonical SMILES to an inline SVG string, or None on failure."""
    if not smiles:
        return None
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    rdDepictor.SetPreferCoordGen(True)
    try:
        rdDepictor.Compute2DCoords(mol)
    except Exception:
        return None

    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    opts = drawer.drawOptions()
    opts.clearBackground = False
    opts.bondLineWidth = 2
    opts.padding = 0.06
    if dark:
        # Light strokes read correctly on the dashboard's dark surfaces.
        opts.setAtomPalette({-1: (0.88, 0.89, 0.91)})

    try:
        rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol)
    except Exception:
        return None
    drawer.FinishDrawing()
    return drawer.GetDrawingText()
