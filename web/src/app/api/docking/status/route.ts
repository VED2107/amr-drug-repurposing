import { NextResponse } from "next/server";

import { getDockingStatus } from "@/lib/queries/docking";

export const dynamic = "force-dynamic";

/**
 * Live progress of the batch docking campaign, computed from the database on
 * every request. Nothing is cached and nothing is stored as a running total.
 */
export async function GET() {
  try {
    const status = await getDockingStatus();
    if (!status) {
      return NextResponse.json({ available: false, reason: "no docking run on this database" }, { status: 404 });
    }
    return NextResponse.json({ available: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { available: false, reason: "docking status could not be read", detail: (error as Error).message },
      { status: 503 },
    );
  }
}
