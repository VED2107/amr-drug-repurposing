import "server-only";

import path from "node:path";

import initRDKitModule from "@rdkit/rdkit";
import type { MainModule as RDKitModule } from "@rdkit/rdkit";

/**
 * Two-dimensional depictions, drawn from the SMILES already in the database.
 *
 * The picture is not a new fact. It is the same `molecules.canonical_smiles`
 * the featuriser read, laid out by RDKit so a reader can see the chemistry
 * instead of parsing a string. Nothing here invents a structure: a molecule
 * with no SMILES, or with a SMILES RDKit cannot parse, renders as an explicit
 * "no depiction" state rather than a placeholder drawing.
 *
 * RDKit runs in the Node runtime only — the WebAssembly binary is never sent
 * to the browser, so a page ships the finished SVG and no chemistry toolkit.
 */

/** Carbon is drawn in this sentinel, then swapped for `currentColor`. */
const CARBON_SENTINEL = "#11120E";

/**
 * Element colours, matched to the interface tokens rather than to RDKit's
 * defaults. Convention is kept — nitrogen cool, oxygen warm — but pure red and
 * pure blue are replaced by the palette's indigo and rose so a depiction sits
 * in the page instead of shouting over it.
 */
const ATOM_COLOURS: Record<number, [number, number, number]> = {
  6: [0.07, 0.07, 0.055], // C  — sentinel, becomes currentColor
  7: [0.216, 0.188, 0.639], // N  — --color-link   #3730a3
  8: [0.745, 0.07, 0.235], // O  — --color-rose   #be123c
  9: [0.059, 0.463, 0.431], // F  — --color-experimental #0f766e
  15: [0.706, 0.325, 0.035], // P  — --color-accent #b45309
  16: [0.706, 0.325, 0.035], // S  — --color-accent #b45309
  17: [0.059, 0.463, 0.431], // Cl — --color-experimental
  35: [0.427, 0.157, 0.851], // Br — --color-violet #6d28d9
  53: [0.427, 0.157, 0.851], // I  — --color-violet
};

/*
  Emscripten asks for a filesystem path to its .wasm. It is built from the
  project root rather than resolved as a module: the bundler rewrites both a
  literal specifier and `require.resolve` into its own loader, and neither can
  return a real path on disk at runtime.
*/
const WASM_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@rdkit",
  "rdkit",
  "dist",
  "RDKit_minimal.wasm",
);

let modulePromise: Promise<RDKitModule> | null = null;

function loadRDKit(): Promise<RDKitModule> {
  modulePromise ??= initRDKitModule({ locateFile: () => WASM_PATH });
  return modulePromise;
}

export interface StructureSvg {
  svg: string;
  width: number;
  height: number;
}

interface RenderOptions {
  width?: number;
  height?: number;
  /** Stereocentre labels. Off for small scaffold thumbnails, on for a lead figure. */
  annotateStereo?: boolean;
}

/** Depictions are deterministic for a given SMILES, so one render per input is enough. */
const cache = new Map<string, StructureSvg | null>();
const CACHE_LIMIT = 512;

/**
 * Render one SMILES to an inline SVG, or `null` when there is nothing honest to
 * draw. `null` means "this molecule has no depiction here" — never a stand-in
 * structure, and never a different molecule's picture.
 */
export async function renderStructure(
  smiles: string | null | undefined,
  options: RenderOptions = {},
): Promise<StructureSvg | null> {
  const source = smiles?.trim();
  if (!source) return null;

  const width = options.width ?? 460;
  const height = options.height ?? 320;
  const annotateStereo = options.annotateStereo ?? true;
  const key = `${width}x${height}:${annotateStereo ? "s" : "-"}:${source}`;

  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let result: StructureSvg | null = null;
  try {
    const RDKit = await loadRDKit();
    const mol = RDKit.get_mol(source);
    if (mol) {
      try {
        if (mol.is_valid()) {
          const raw = mol.get_svg_with_highlights(
            JSON.stringify({
              width,
              height,
              backgroundColour: [0, 0, 0, 0],
              bondLineWidth: 1.6,
              fixedFontSize: 15,
              addStereoAnnotation: annotateStereo,
              atomColourPalette: ATOM_COLOURS,
            }),
          );
          result = { svg: cleanSvg(raw), width, height };
        }
      } finally {
        mol.delete();
      }
    }
  } catch (error) {
    // A depiction is a convenience; a page must still render its numbers.
    console.error("structure depiction failed", error);
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

/**
 * Make RDKit's output behave like page furniture: no XML preamble, no opaque
 * background, no fixed pixel box, and carbon drawn in the reader's text colour
 * so the depiction follows the theme instead of fighting it.
 */
function cleanSvg(raw: string): string {
  return raw
    .replace(/<\?xml[^?]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/<rect[^>]*>\s*<\/rect>/g, "")
    .replace(/<rect[^>]*\/>/g, "")
    .replace(/\swidth='\d+px'/, "")
    .replace(/\sheight='\d+px'/, "")
    .replace(new RegExp(CARBON_SENTINEL, "gi"), "currentColor")
    .replace(/#000000/gi, "currentColor")
    .trim();
}
