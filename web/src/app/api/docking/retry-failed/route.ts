import { NextResponse } from "next/server";

import { operatorCheck } from "@/lib/operator";
import { retryFailedJobs } from "@/lib/queries/docking";

export const dynamic = "force-dynamic";

/**
 * Requeue docking failures (optionally one job: `{ "jobId": 123 }`). Input
 * failures (no structure, ligand or target preparation failed) are not
 * retried: retrying cannot change them. Workers pick the jobs up; nothing is
 * docked in this function.
 */
export async function POST(req: Request) {
  const auth = operatorCheck(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { jobId?: unknown };
  const jobId = Number.isInteger(body.jobId) && Number(body.jobId) > 0 ? Number(body.jobId) : undefined;
  const n = await retryFailedJobs(jobId);
  if (n == null) return NextResponse.json({ error: "no docking run" }, { status: 404 });
  return NextResponse.json({ requeued: n });
}
