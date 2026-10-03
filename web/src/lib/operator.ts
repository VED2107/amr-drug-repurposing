import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Operator actions (retry, resume) change the docking queue. They are allowed
 * only with the token in DOCKING_OPERATOR_TOKEN, sent as a Bearer header. With
 * no token configured the actions are disabled, never open.
 */
export function operatorCheck(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.DOCKING_OPERATOR_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "operator actions are disabled on this deployment" };
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: "invalid operator token" };
  return { ok: true };
}
