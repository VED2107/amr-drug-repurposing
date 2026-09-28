"use client";

import { useState } from "react";

import { formatUnits } from "@/lib/format";
import { chemblAssay, chemblDocument } from "@/lib/links";

interface Row {
  pathogenKey: string;
  assayId: string | null;
  assayDescription: string | null;
  activityType: string | null;
  relation: string | null;
  value: number | null;
  units: string | null;
  label: number;
  documentId: string | null;
  year: number | null;
}

/** How many records the panel lists; the rest are one link away in ChEMBL. */
export const LAB_RECORD_LIMIT = 150;

/**
 * The laboratory records behind a medicine, each linked to its ChEMBL assay
 * and publication. The rows are fetched the first time the panel is opened, so
 * a medicine page does not carry them until a reader asks.
 */
export function LabRecords({
  moleculeId,
  total,
  pathogenLabels,
}: {
  moleculeId: string;
  total: number;
  pathogenLabels: Record<string, string>;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = Math.min(total, LAB_RECORD_LIMIT);
  const n = (v: number) => v.toLocaleString("en-GB");

  async function load() {
    if (rows !== null) return;
    setFailed(false);
    try {
      const res = await fetch(`/api/lab-records/${encodeURIComponent(moleculeId)}`);
      if (!res.ok) throw new Error(String(res.status));
      setRows((await res.json()) as Row[]);
    } catch {
      // A failed fetch is said as a failure, never shown as "no records".
      setFailed(true);
    }
  }

  return (
    <details
      className="group mt-4"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
        {total > shown
          ? `Show the latest ${n(shown)} of ${n(total)} laboratory records, with sources`
          : `Show the ${n(total)} laboratory ${total === 1 ? "record" : "records"}, with sources`}
      </summary>

      {failed ? (
        <p role="alert" className="m-0 mt-2 text-[13px] text-ink-2">
          The records could not be loaded just now.{" "}
          <button type="button" onClick={() => void load()} className="underline decoration-accent underline-offset-4">
            Try again
          </button>
        </p>
      ) : rows === null ? (
        <p aria-busy="true" className="m-0 mt-2 text-[13px] text-muted">
          Loading records…
        </p>
      ) : (
        <ul className="m-0 mt-2 max-h-[420px] list-none overflow-y-auto rounded-card border border-rule p-0">
          {rows.map((r, i) => (
            <li
              key={`${r.assayId}-${i}`}
              className="grid gap-x-4 gap-y-1 border-b border-rule-soft px-3 py-2.5 text-[12px] leading-snug last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)_11rem_auto]"
            >
              <span className="font-medium text-ink">{pathogenLabels[r.pathogenKey] ?? r.pathogenKey}</span>
              <span className="text-ink-2">{r.assayDescription ?? "Assay description not recorded"}</span>
              <span className="font-mono tabular-nums text-ink">
                {r.activityType ?? "Value"} {r.relation && r.relation !== "=" ? r.relation : ""}
                {r.value ?? "—"} {formatUnits(r.units)}
                <span className={`ml-1.5 font-sans ${r.label === 1 ? "text-experimental" : "text-muted"}`}>
                  {r.label === 1 ? "active" : "inactive"}
                </span>
              </span>
              <span className="flex flex-wrap gap-x-3">
                {r.assayId ? (
                  <a href={chemblAssay(r.assayId)} target="_blank" rel="noreferrer">
                    Assay ↗
                  </a>
                ) : null}
                {r.documentId ? (
                  <a href={chemblDocument(r.documentId)} target="_blank" rel="noreferrer">
                    Source{r.year ? ` ${r.year}` : ""} ↗
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 mt-2 text-[12px] text-muted">
        {total > shown ? "Every record is in ChEMBL, linked above. " : ""}
        &ldquo;Active&rdquo; means the measured value reached this project&rsquo;s laboratory cutoff
        (10&nbsp;µM or stronger). A laboratory result does not show an effect in patients.
      </p>
    </details>
  );
}
