import Link from "next/link";
import type { ReactNode } from "react";

import { withParams, type RawSearchParams } from "@/lib/url";

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

/**
 * A table inside its own scroll container.
 *
 * The page itself never scrolls sideways — `globals.css` guards that — so a
 * wide table takes the overflow rather than pushing the layout out. The wrapper
 * is focusable so the scroll region can be reached from the keyboard.
 */
export function TableWrap({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      className="scroll-x border border-rule bg-raised"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="w-full min-w-[720px] text-left">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  width,
  scope = "col",
}: {
  children: ReactNode;
  align?: "left" | "right";
  width?: string;
  scope?: "col" | "row";
}) {
  return (
    <th
      scope={scope}
      style={width ? { width } : undefined}
      className={`border-b border-rule-strong bg-sunken px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-rule-soft px-3 py-3 align-top text-[13px] leading-snug text-ink-2 ${
        align === "right" ? "text-right" : ""
      } ${mono ? "font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="hover-row">{children}</tr>;
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

/**
 * A column header that sorts.
 *
 * Sorting is a link, not a button: the whole view lives in the URL, so a sorted
 * table is shareable and works with the browser's back button. `aria-sort` is
 * set on the header so a screen reader announces the current order.
 */
export function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDirection,
  path,
  params,
  align = "left",
  width,
}: {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDirection: "asc" | "desc";
  path: string;
  params: RawSearchParams;
  align?: "left" | "right";
  width?: string;
}) {
  const active = currentSort === sortKey;
  const nextDirection = active && currentDirection === "desc" ? "asc" : "desc";
  const href = withParams(path, params, {
    sort: sortKey,
    dir: nextDirection,
    page: null,
  });

  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      aria-sort={active ? (currentDirection === "asc" ? "ascending" : "descending") : "none"}
      className={`border-b border-rule-strong bg-sunken p-0 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Link
        href={href}
        className={`flex min-h-11 items-center gap-1.5 px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] no-underline ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-ink" : "text-muted"}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (currentDirection === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

/**
 * Page controls that say what is being counted.
 *
 * The range is spelled out ("26–50 of 1,691 medicines") because a bare page
 * number hides how much of the library a reader has actually seen.
 */
export function Pagination({
  page,
  pageSize,
  total,
  path,
  params,
  unit,
}: {
  page: number;
  pageSize: number;
  total: number;
  path: string;
  params: RawSearchParams;
  unit: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const link = (target: number, label: string, disabled: boolean) =>
    disabled ? (
      <span
        aria-disabled="true"
        className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-mono text-[11px] text-fainter"
      >
        {label}
      </span>
    ) : (
      <Link
        href={withParams(path, params, { page: target })}
        className="inline-flex min-h-11 items-center rounded-card border border-rule-strong px-3 font-mono text-[11px] text-ink no-underline hover-ink"
      >
        {label}
      </Link>
    );

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="m-0 font-mono text-[11px] tabular-nums text-muted">
        {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of{" "}
        {total.toLocaleString("en-GB")} {unit}
      </p>
      <div className="flex items-center gap-2">
        {link(page - 1, "← Previous", page <= 1)}
        <span className="font-mono text-[11px] tabular-nums text-muted">
          page {page} / {pages}
        </span>
        {link(page + 1, "Next →", page >= pages)}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Filter furniture                                                    */
/* ------------------------------------------------------------------ */

/** A tab strip that switches one parameter while preserving the rest. */
export function TabStrip({
  label,
  options,
  current,
  param,
  path,
  params,
}: {
  label: string;
  options: { value: string; label: string; note?: string }[];
  current: string;
  param: string;
  path: string;
  params: RawSearchParams;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-px border border-rule bg-rule">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value}
            href={withParams(path, params, { [param]: option.value, page: null })}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col justify-center px-4 py-2 no-underline ${
              active ? "bg-ink" : "bg-raised"
            }`}
            style={{ minWidth: "9.5rem" }}
          >
            <span
              className="font-display text-[13px] font-semibold"
              style={{ color: active ? "var(--color-paper)" : "var(--color-ink)" }}
            >
              {option.label}
            </span>
            {option.note ? (
              <span
                className="font-mono text-[10px]"
                style={{ color: active ? "var(--color-rule)" : "var(--color-muted)" }}
              >
                {option.note}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-faint">{hint}</span> : null}
    </label>
  );
}

/** Shared input chrome: 2px corners, real 44px target, no custom focus ring. */
export const inputClass =
  "min-h-11 w-full rounded-card border border-rule-strong bg-pure px-3 font-mono text-[12px] text-ink";

export function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2.5 text-[12px] leading-snug text-ink-2">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-[color:var(--color-accent)]"
      />
      {label}
    </label>
  );
}

/**
 * What the current view is filtered to, stated above the results.
 *
 * A table that silently excludes rows can be read as a complete answer. The
 * chips keep the exclusion visible, and each one links to the view with that
 * filter removed.
 */
export function FilterChips({
  chips,
  path,
  params,
}: {
  chips: { label: string; clear: Record<string, null> }[];
  path: string;
  params: RawSearchParams;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className="m-0 flex flex-wrap items-center gap-2 p-0">
      {chips.map((chip) => (
        <li key={chip.label} className="list-none">
          <Link
            href={withParams(path, params, { ...chip.clear, page: null })}
            className="inline-flex min-h-8 items-center gap-2 rounded-card border border-rule bg-raised px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2 no-underline"
          >
            {chip.label}
            <span aria-hidden="true" className="text-[11px] text-muted">
              ×
            </span>
            <span className="sr-only">(remove this filter)</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Distributions                                                       */
/* ------------------------------------------------------------------ */

/**
 * A counted distribution, drawn as bars with their numbers.
 *
 * No chart library: the value is always written next to the bar, the bar is a
 * scanning aid rather than the carrier of the value, and an empty bucket is
 * kept in place showing zero — a gap in a distribution is a fact about the
 * data, and dropping it would redraw the shape.
 */
export function DistributionBars({
  rows,
  unit,
  emptyNote,
}: {
  rows: { label: string; count: number }[];
  unit: string;
  emptyNote?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  if (rows.length === 0) {
    return (
      <p className="m-0 text-[13px] leading-relaxed text-muted">
        {emptyNote ?? "No rows to count."}
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Distribution by {unit}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-rule-soft">
            <th
              scope="row"
              className="w-[30%] py-2 pr-3 align-middle font-mono text-[11px] font-normal text-ink-2"
            >
              {row.label}
            </th>
            <td className="py-2 align-middle">
              <span className="block h-[10px] w-full bg-sunken">
                <span
                  className="block h-full"
                  style={{
                    width: max === 0 ? "0%" : `${((row.count / max) * 100).toFixed(2)}%`,
                    background: "var(--color-computational)",
                  }}
                />
              </span>
            </td>
            <td className="w-[16%] py-2 pl-3 text-right align-middle font-mono text-[12px] tabular-nums text-ink">
              {row.count.toLocaleString("en-GB")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
