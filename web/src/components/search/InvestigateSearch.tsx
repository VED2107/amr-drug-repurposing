"use client";

import { useState } from "react";

import { SearchField } from "./SearchField";

type Mode = "medicine" | "condition";

/* Condition comes first: condition → pathogen → documented medicines → other
   medicines to investigate is the site's main repurposing question. */
const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: "condition", label: "Condition", placeholder: "Search a condition, e.g. Tuberculosis" },
  { key: "medicine", label: "Medicine", placeholder: "Search a medicine, e.g. Levoketoconazole" },
];

/**
 * The one search on the site: a medicine or a condition.
 *
 * A plain GET form to `/investigate`, so every result has a URL that can be
 * refreshed or shared. Taking a medicine suggestion goes straight to that
 * medicine; typed text is resolved on the server. The mode switch is a radio
 * group, because it is one choice between two, not two buttons.
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

  return (
    <form
      action="/investigate"
      method="get"
      role="search"
      className={`flex w-full flex-col gap-2 ${compact ? "sm:flex-row sm:items-center" : ""}`}
    >
      <div
        role="radiogroup"
        aria-label="Search for"
        className="inline-flex shrink-0 self-start rounded-card border border-rule-strong bg-raised p-0.5"
      >
        {MODES.map((m) => {
          const on = m.key === mode;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m.key)}
              className={`min-h-10 rounded-[1px] px-3.5 font-display text-[13px] font-semibold transition-colors duration-150 ${
                on ? "bg-ink text-paper" : "text-ink-2 hover-ink"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 gap-2">
        <SearchField
          key={mode}
          name={mode}
          source={mode === "medicine" ? "medicines" : "conditions"}
          label={`Search ${mode}`}
          placeholder={current.placeholder}
          navigate={mode === "medicine"}
          submitOnSelect={mode === "condition"}
          className="min-w-0 flex-1"
          inputClassName={compact ? "" : "min-h-13 text-[14px]"}
        />
        <button type="submit" className={compact ? "amr-btn-quiet" : "amr-btn"}>
          Investigate
        </button>
      </div>
    </form>
  );
}
