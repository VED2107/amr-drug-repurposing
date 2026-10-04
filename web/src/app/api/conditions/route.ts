import { NextResponse } from "next/server";

import { getConditionSuggestions } from "@/lib/queries/investigate";

export const dynamic = "force-dynamic";

/**
 * Condition lookup for the search and the studies filter.
 *
 * Suggestions come from conditions that registered studies in this database
 * actually name, plus the four modelled pathogens. A condition absent from the
 * list can still be typed: the investigation answers for any condition, and
 * says explicitly when no model covers it.
 */
export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("q") ?? "";
  if (term.trim().length < 2) return NextResponse.json([]);

  try {
    return NextResponse.json(await getConditionSuggestions(term, 8));
  } catch (error) {
    console.error("condition lookup failed", error);
    return NextResponse.json({ error: "lookup unavailable" }, { status: 503 });
  }
}
