"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { locate } from "@/lib/nav";
import type { Readouts } from "@/lib/queries/nav";
import { Gauge, ResearchIndex } from "./ResearchIndex";

/**
 * The research index below 1024px: a location bar, not a tab bar.
 *
 * One full-width bar along the bottom edge says where you are — stage number,
 * section, and that section's live figure — and opens the same index the rail
 * shows on a wide screen. A phone gets the same model of the system as a
 * desktop, rather than four favourite tabs and a drawer of the rest.
 *
 * The sheet remembers which route it was opened on, so navigating closes it in
 * the same render as the new page appears. Escape closes it; focus moves to it
 * when it opens and back to the bar when it closes. Targets are at least 44px,
 * and the bar clears the home indicator via `safe-area-inset-bottom`.
 */
export function MobileIndex({
  readouts,
  dataVersion,
}: {
  readouts: Readouts;
  dataVersion: string | null;
}) {
  const pathname = usePathname();
  const sheetId = useId();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const sheetRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      sheetRef.current?.focus();
      wasOpen.current = true;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpenedOn(null);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      barRef.current?.focus();
    }
  }, [open]);

  const here = locate(pathname);
  const readout = here?.item.readout ? readouts[here.item.readout] : undefined;

  return (
    <>
      {open ? (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpenedOn(null)}
            className="fixed inset-0 z-40 bg-[rgba(18,19,15,0.28)] lg:hidden"
          />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Research index"
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto border-t border-rule-strong bg-paper px-5 pt-4 outline-none lg:hidden"
            style={{ paddingBottom: "calc(4.75rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setOpenedOn(null)}
                className="inline-flex min-h-11 items-center border border-rule px-3 font-mono text-[11px] text-ink"
              >
                Close
              </button>
            </div>
            <ResearchIndex readouts={readouts} dataVersion={dataVersion} compact />
          </div>
        </>
      ) : null}

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule-strong bg-raised lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <button
          ref={barRef}
          type="button"
          onClick={() => setOpenedOn(open ? null : pathname)}
          aria-expanded={open}
          aria-controls={sheetId}
          className="grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 text-left"
        >
          <span className="font-mono text-[11px] tabular-nums text-accent">{here?.group.n ?? "··"}</span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] font-semibold text-ink">
              {here?.item.label ?? "Research index"}
            </span>
            <span className="block truncate font-mono text-[10px] text-muted">
              {here ? here.group.label : "all sections"}
              {readout ? ` · ${readout.text}` : ""}
            </span>
            {readout?.gauge ? <Gauge gauge={readout.gauge} className="mt-1.5 max-w-[14rem]" /> : null}
          </span>
          <span className="inline-flex min-h-11 items-center gap-1.5 border-l border-rule pl-3 font-mono text-[11px] text-ink">
            {open ? "Close" : "Index"}
            <span aria-hidden="true">{open ? "↓" : "↑"}</span>
          </span>
        </button>
      </div>
    </>
  );
}
