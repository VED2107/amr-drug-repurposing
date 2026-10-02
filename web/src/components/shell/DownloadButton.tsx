"use client";

import { useRef, useState, type ReactNode } from "react";

type State = "idle" | "working" | "done" | "error";

/**
 * A CSV download that says what it is doing.
 *
 * The files are built on request and take a few seconds, during which a plain
 * link looks broken. This fetches the file, shows a progress fill while the
 * server works, saves it under the server's own file name, and then reports
 * how many rows arrived. If anything fails it says so and offers the plain
 * link. Without script it is that plain link.
 */
export function DownloadButton({ href, children }: { href: string; children: ReactNode }) {
  const [state, setState] = useState<State>("idle");
  const [rows, setRows] = useState<string | null>(null);
  const busy = useRef(false);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setState("working");
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "smart-screening.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const count = res.headers.get("x-row-count");
      setRows(count ? Number(count).toLocaleString("en-GB") : null);
      setState("done");
      setTimeout(() => setState("idle"), 3200);
    } catch {
      setState("error");
    } finally {
      busy.current = false;
    }
  }

  return (
    <span className="inline-flex flex-col gap-1.5">
      <a
        href={href}
        download
        onClick={onClick}
        data-state={state}
        aria-busy={state === "working"}
        className="amr-btn-quiet amr-download"
      >
        <span aria-hidden="true" className="amr-download-fill" />
        <span className="amr-download-icon" aria-hidden="true" />
        <span aria-live="polite">
          {state === "working" ? "Preparing file…" : state === "done" ? `Saved${rows ? ` · ${rows} rows` : ""}` : children}
        </span>
      </a>
      {state === "error" ? (
        <span role="alert" className="text-[12px] text-rose">
          The file could not be prepared. Try again, or{" "}
          <a href={href} download>
            download it directly
          </a>
          .
        </span>
      ) : null}
    </span>
  );
}
