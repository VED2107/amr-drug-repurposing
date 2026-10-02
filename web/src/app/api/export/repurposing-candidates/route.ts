import { csvHeaders, exportFilename, repurposingCandidatesCsv } from "@/lib/export";
import { isPathogenKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The repurposing candidates as CSV: every one, or those for one pathogen
 * (`?pathogen=mtb`). The same population the dashboard and the lists count.
 */
export async function GET(request: Request) {
  const pathogen = new URL(request.url).searchParams.get("pathogen");
  if (pathogen !== null && !isPathogenKey(pathogen)) {
    return new Response("Unknown pathogen", { status: 400 });
  }
  try {
    const { csv, rows } = await repurposingCandidatesCsv(pathogen ?? undefined);
    const population = pathogen ? `repurposing-candidates-${pathogen}` : "repurposing-candidates";
    return new Response(csv, { headers: csvHeaders(exportFilename(population, rows), rows) });
  } catch (error) {
    console.error("repurposing-candidates export failed", error);
    return new Response("Export unavailable", { status: 503 });
  }
}
