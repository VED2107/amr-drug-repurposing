import { NextResponse } from "next/server";
import { searchMedicines } from "@/lib/queries/investigate";

export const dynamic = "force-dynamic";

/**
 * Medicine lookup for the search.
 *
 * Returns an empty list for a short or absent term. An empty list here means
 * "nothing matched", which the client renders as "no match in the documented
 * subset" — a statement about this database, not about the medicine.
 */
export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("q") ?? "";
  if (term.trim().length < 2) return NextResponse.json([]);

  try {
    const hits = await searchMedicines(term, 8);
    return NextResponse.json(hits);
  } catch (error) {
    console.error("search failed", error);
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
}
