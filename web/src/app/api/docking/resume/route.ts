import { NextResponse } from "next/server";

import { operatorCheck } from "@/lib/operator";
import { resumeRun } from "@/lib/queries/docking";

export const dynamic = "force-dynamic";

/**
 * Return jobs held by workers that stopped heartbeating to the queue and
 * unpause the run. Completed jobs are never touched. Docking itself happens in
 * the worker containers, never in this function.
 */
export async function POST(req: Request) {
  const auth = operatorCheck(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await resumeRun();
  if (!r) return NextResponse.json({ error: "no docking run" }, { status: 404 });
  return NextResponse.json(r);
}
