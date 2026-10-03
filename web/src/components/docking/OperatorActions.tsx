"use client";

import { useState } from "react";

/**
 * Retry failed / Resume. These change the shared queue, so they need the
 * operator token (DOCKING_OPERATOR_TOKEN); the token is kept for this tab only.
 * Docking itself always runs in the worker containers, never in the website.
 */
export function OperatorActions({ failed }: { failed: number }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: "retry-failed" | "resume") {
    let token = "";
    try {
      token = sessionStorage.getItem("amr-docking-token") ?? "";
    } catch {}
    if (!token) {
      token = window.prompt("Operator token (DOCKING_OPERATOR_TOKEN)") ?? "";
      if (!token) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/docking/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        try {
          sessionStorage.setItem("amr-docking-token", token);
        } catch {}
        setMessage(
          path === "retry-failed"
            ? `${body.requeued ?? 0} failed jobs returned to the queue.`
            : `Run resumed; ${body.requeued ?? 0} stalled jobs returned to the queue. Completed jobs are kept.`,
        );
      } else {
        if (res.status === 401) {
          try {
            sessionStorage.removeItem("amr-docking-token");
          } catch {}
        }
        setMessage(String(body.error ?? `Request failed (${res.status})`));
      }
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex min-h-10 items-center rounded-full border border-rule-strong bg-raised px-4 font-display text-[13px] font-semibold text-ink disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn} disabled={busy || failed === 0} onClick={() => act("retry-failed")}>
        Retry failed{failed ? ` (${failed.toLocaleString("en-GB")})` : ""}
      </button>
      <button type="button" className={btn} disabled={busy} onClick={() => act("resume")}>
        Resume
      </button>
      {message ? (
        <p role="status" className="m-0 text-[13px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
