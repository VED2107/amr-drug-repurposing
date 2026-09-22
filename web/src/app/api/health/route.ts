import { NextResponse } from "next/server";

import { query } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Whether this deployment can reach its database, and if not, why.
 *
 * A 500 on a page says only that something failed. This says which thing, which
 * is the difference between a deployment you can fix and one you can only guess
 * at. It exists because that guesswork is expensive on a host whose logs are
 * not to hand.
 *
 * It deliberately reveals no credential. The connection string is parsed for
 * its host and port only — never the user, never the password — and the host of
 * a Supabase project is already public in `NEXT_PUBLIC_SUPABASE_URL`. What it
 * adds is which *endpoint* the deployment is actually using, because the direct
 * endpoint and the pooler behave very differently on a host with no IPv6 route.
 */

interface Diagnosis {
  ok: boolean;
  configured: boolean;
  endpoint: string | null;
  port: number | null;
  kind: "pooler" | "direct" | "other" | null;
  dataSource: string;
  rows?: number;
  error?: { name: string; code?: string; message: string };
  hint?: string;
}

/** Host and port only. Anything before `@` is discarded before parsing. */
function describeEndpoint(url: string | undefined): Pick<Diagnosis, "endpoint" | "port" | "kind"> {
  if (!url) return { endpoint: null, port: null, kind: null };
  try {
    const withoutCredentials = url.replace(/\/\/[^@]*@/, "//");
    const parsed = new URL(withoutCredentials);
    const host = parsed.hostname;
    const kind = host.includes("pooler.")
      ? ("pooler" as const)
      : host.startsWith("db.")
        ? ("direct" as const)
        : ("other" as const);
    return { endpoint: host, port: parsed.port ? Number(parsed.port) : null, kind };
  } catch {
    return { endpoint: null, port: null, kind: "other" };
  }
}

export async function GET() {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  const endpoint = describeEndpoint(url);

  const diagnosis: Diagnosis = {
    ok: false,
    configured: Boolean(url),
    dataSource: process.env.AMR_DATA_SOURCE ?? "supabase",
    ...endpoint,
  };

  if (!url) {
    diagnosis.hint =
      "DATABASE_URL is not set on this deployment. Add it under Settings → " +
      "Environment Variables and redeploy: a variable added after a deployment " +
      "is built does not reach the deployment already running.";
    return NextResponse.json(diagnosis, { status: 503 });
  }

  try {
    const rows = await query<{ n: number }>("select count(*) as n from molecules", []);
    diagnosis.ok = true;
    diagnosis.rows = Number(rows[0]?.n ?? 0);
    return NextResponse.json(diagnosis);
  } catch (error) {
    const err = error as { name?: string; code?: string; message?: string };
    diagnosis.error = {
      name: err.name ?? "Error",
      code: err.code,
      // Trimmed, and it carries no credential: the drivers report host and port.
      message: (err.message ?? String(error)).slice(0, 300),
    };

    if (diagnosis.kind === "direct") {
      diagnosis.hint =
        "This deployment is using the direct database endpoint (db.<ref>.supabase.co), " +
        "which resolves to IPv6 only. Serverless hosts generally have no IPv6 route, so " +
        "the connection cannot be made. Use the transaction pooler string instead: user " +
        "postgres.<ref>, host aws-0-<region>.pooler.supabase.com, port 6543.";
    } else if (err.code === "XX000" || /tenant or user not found/i.test(err.message ?? "")) {
      diagnosis.hint =
        "The pooler rejected the tenant. The region in the hostname is probably wrong, or " +
        "the username is not in the form postgres.<project-ref>.";
    } else if (/password authentication failed/i.test(err.message ?? "")) {
      diagnosis.hint =
        "The credential was rejected. If the database password was rotated, update " +
        "DATABASE_URL here and redeploy.";
    } else {
      diagnosis.hint =
        "The database was unreachable. Check that DATABASE_URL is set for this " +
        "environment and that the deployment was rebuilt after it changed.";
    }

    return NextResponse.json(diagnosis, { status: 503 });
  }
}
