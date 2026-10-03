import { NextResponse } from "next/server";

import { queryLive } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Download a docking artifact (pose PDBQT, Vina log, prepared ligand or
 * receptor) from the private storage bucket. The bytes are checked against the
 * SHA-256 recorded in the database before they are served.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await ctx.params;
  const id = Number(artifactId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid artifact id" }, { status: 400 });

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "artifact storage is not configured on this deployment" }, { status: 503 });
  }
  const rows = await queryLive<Record<string, unknown>>(
    `select object_key, sha256, remote_bucket from docking.artifacts where id = ?`,
    [id],
  ).catch(() => null);
  const a = rows?.[0];
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!a.remote_bucket) return NextResponse.json({ error: "artifact is not in shared storage" }, { status: 404 });

  const objectKey = String(a.object_key);
  const path = objectKey.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `${url.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(String(a.remote_bucket))}/${path}`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key }, cache: "no-store" },
  );
  if (!res.ok) return NextResponse.json({ error: `storage returned ${res.status}` }, { status: 502 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  if (digest !== String(a.sha256)) {
    return NextResponse.json({ error: "stored file does not match its recorded checksum" }, { status: 502 });
  }
  const filename = objectKey.split("/").slice(-2).join("_");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-SHA256": digest,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
