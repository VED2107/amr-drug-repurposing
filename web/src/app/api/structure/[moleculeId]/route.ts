import { getStructureSmiles } from "@/lib/queries/investigate";
import { renderStructure } from "@/lib/structure";

/**
 * One medicine's structure drawing, as an image file.
 *
 * Served separately rather than inlined so a result page does not carry every
 * drawing twice (once in its HTML, once in the React payload), and so the
 * browser and the CDN can keep each drawing. The drawing is a function of the
 * molecule's identity (its InChIKey), which never changes for a given key, so
 * it can be cached for a long time.
 *
 * Two sizes: `lg` for the medicine's own figure, `sm` for list thumbnails.
 */

const SIZES = {
  lg: { width: 420, height: 300, annotateStereo: true },
  sm: { width: 184, height: 140, annotateStereo: false },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ moleculeId: string }> },
) {
  const { moleculeId } = await params;
  const size = new URL(request.url).searchParams.get("size") === "sm" ? "sm" : "lg";

  let smiles: string | null;
  try {
    smiles = await getStructureSmiles(decodeURIComponent(moleculeId));
  } catch (error) {
    console.error("structure lookup failed", error);
    return new Response("structure lookup unavailable", { status: 503 });
  }

  const drawing = smiles ? await renderStructure(smiles, { ...SIZES[size], standalone: true }) : null;
  if (!drawing) return new Response("no structure", { status: 404 });

  return new Response(drawing.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // A day in the browser, a year at the CDN; serve stale while refreshing.
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
      // The file is only ever an image: no scripts, no outside resources.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
