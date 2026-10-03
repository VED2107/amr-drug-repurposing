import { NextResponse } from "next/server";

import { dockingOpsEnabled } from "@/lib/dockingOps";

/** Docking operations are local-only: 404 wherever AMR_DOCKING_OPS is not set (see lib/dockingOps). */
export function proxy() {
  if (dockingOpsEnabled()) return NextResponse.next();
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  matcher: ["/docking", "/docking/:path*", "/api/docking/:path*"],
};
