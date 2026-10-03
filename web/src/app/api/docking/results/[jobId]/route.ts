import { NextResponse } from "next/server";

import { getDockingJob } from "@/lib/queries/docking";

export const dynamic = "force-dynamic";

/** One docking job with its full provenance. */
export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid job id" }, { status: 400 });
  const job = await getDockingJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
