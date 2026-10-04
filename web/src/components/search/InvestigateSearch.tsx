"use client";

import Link from "next/link";
import { useState } from "react";

import { SearchField } from "./SearchField";

type Mode = "medicine" | "condition";

/* Condition comes first: condition → pathogen → documented medicines → other
   medicines to investigate is the site's main repurposing question. */
const MODES: { key: Mode; label: string; placeholder: string; short: string }[] = [
  { key: "condition", label: "Pathogen coverage", placeholder: "Search a disease or pathogen, e.g. Tuberculosis", short: "e.g. Tuberculosis" },
  { key: "medicine", label: "Medicine", placeholder: "Search a medicine, e.g. Levoketoconazole", short: "e.g. Levoketoconazole" },
];

/**
 * One-click examples. Each condition below maps to a modelled pathogen
 * (`matchModelledPathogen`); each medicine is in the approved library.
 */
const EXAMPLES: Record<Mode, string[]> = {
  condition: ["Tuberculosis", "MRSA", "Klebsiella infection", "E. coli infection"],
  medicine: ["Levoketoconazole", "Ciprofloxacin"],
};

/**
 * The one search on the site: a medicine or a condition.
 *
 * A plain GET form to `/investigate`, so every result has a URL that can be
 * refreshed or shared. Taking a medicine suggestion goes straight to that
 * medicine; typed text is resolved on the server. The mode switch is a radio
 * group, because it is one choice between two, not two buttons.
 *
 * Drawn as one capsule: the mode switch (an ink pill that slides between the
 * two choices), the field, and a round ochre cap that submits. The whole
 * capsule takes the focus ring, so it reads as a single instrument.
 */
export function InvestigateSearch({
  initialMode = "condition",
  compact = false,
}: {
  initialMode?: Mode;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const current = MODES.find((m) => m.key === mode) ?? MODES[0];
  const index = MODES.findIndex((m) => m.key === mode);

  return (
    <div className="w-full">
      <form
        action="/investigate"
        method="get"
        role="search"
        className={`amr-search flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-0 ${compact ? "amr-search-compact" : ""}`}
      >
        <div
          role="radiogroup"
          aria-label="Search for"
          className="amr-modes relative grid shrink-0 grid-cols-2 self-start rounded-full sm:self-center"
          style={{ ["--at" as string]: index }}
        >
          <span aria-hidden="true" className="amr-modes-pill" />
          {MODES.map((m) => {
            const on = m.key === mode;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.key)}
                className="amr-mode relative z-[1] whitespace-nowrap rounded-full font-display font-semibold"
              >
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="amr-search-field flex min-w-0 flex-1 items-center">
          <SearchField
            key={mode}
            name={mode}
            source={mode === "medicine" ? "medicines" : "conditions"}
            label={`Search ${mode}`}
            placeholder={compact ? current.short : current.placeholder}
            navigate={mode === "medicine"}
            submitOnSelect={mode === "condition"}
            className="min-w-0 flex-1"
            inputClassName="amr-search-input"
          />
          <button type="submit" className="amr-search-go" aria-label="Investigate">
            <span className="amr-search-go-label">Investigate</span>
            <span aria-hidden="true" className="amr-search-go-cap">
              <svg viewBox="0 0 16 16" width="15" height="15">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
          </button>
        </div>
      </form>

      {!compact ? (
        <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="font-mono">Try</span>
          {EXAMPLES[mode].map((ex) => (
            <Link
              key={ex}
              href={`/investigate?${mode}=${encodeURIComponent(ex)}`}
              className="amr-example rounded-full border border-rule bg-raised px-3 py-1 text-[12px] text-ink-2 no-underline"
            >
              {ex}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}
