import { NextResponse, type NextRequest } from "next/server";

import { listDockingResults } from "@/lib/queries/docking";

export const dynamic = "force-dynamic";

const num = (v: string | null) => (v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Docking jobs and their results, filterable. A docking score is a
 * computational ranking metric, not a measure of clinical efficacy.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const data = await listDockingResults({
      drug: p.get("drug") ?? undefined,
      target: p.get("target") ?? undefined,
      organism: p.get("organism") ?? undefined,
      status: p.get("status") ?? undefined,
      outcome: (p.get("outcome") as "completed" | "failed" | null) ?? undefined,
      minAffinity: num(p.get("minAffinity")),
      maxAffinity: num(p.get("maxAffinity")),
      run: p.get("run") ?? undefined,
      sort: p.get("sort") === "recent" ? "recent" : "affinity",
      page: num(p.get("page")) ?? 1,
      pageSize: num(p.get("pageSize")) ?? 50,
    });
    if (!data) return NextResponse.json({ available: false }, { status: 404 });
    return NextResponse.json(
      {
        available: true,
        note:
          "Docking scores (kcal/mol, AutoDock Vina) rank predicted fit to one protein structure. " +
          "They are computational evidence only and do not show that a medicine treats an infection.",
        ...data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ available: false, detail: (error as Error).message }, { status: 503 });
  }
}
