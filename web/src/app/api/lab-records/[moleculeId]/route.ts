import { NextResponse } from "next/server";

import { getLabRecords } from "@/lib/queries/investigate";

/**
 * One medicine's laboratory records, with their ChEMBL sources.
 *
 * Fetched when a reader opens the records panel rather than shipped inside
 * every medicine page: a page carries its markup twice (HTML and React
 * payload), and 150 rows of it is most of a page nobody asked to expand.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ moleculeId: string }> },
) {
  const { moleculeId } = await params;
  try {
    const records = await getLabRecords(decodeURIComponent(moleculeId));
    return NextResponse.json(records, {
      // Records change only when the research pipeline republishes.
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("lab records lookup failed", error);
    return NextResponse.json({ error: "records unavailable" }, { status: 503 });
  }
}
