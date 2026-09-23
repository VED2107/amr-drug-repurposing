import Link from "next/link";
import type { ReactNode } from "react";

import { PageTransition } from "@/components/motion";

/* ------------------------------------------------------------------ */
/* Page furniture                                                      */
/* ------------------------------------------------------------------ */

/**
 * The page body.
 *
 * Wrapped in `PageTransition` here rather than in the layout: a layout persists
 * across navigation, so its enter and exit would never fire. Every surface
 * renders through this component, so every surface transitions the same way.
 */
export function Page({ children }: { children: ReactNode }) {
  return (
    <PageTransition>
      <div className="mx-auto max-w-shell px-4 py-8 md:px-8 md:py-12 lg:px-12">{children}</div>
    </PageTransition>
  );
}

export function Breadcrumb({ trail }: { trail: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <p className="m-0 font-mono text-[11px] text-muted">{trail.join(" / ")}</p>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-8 border-b border-rule pb-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="m-0 font-display text-[clamp(26px,3vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {lede ? (
            <p className="m-0 mt-3 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">{lede}</p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  note,
  children,
  reveal = false,
  id,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  /** Anchor, for linking straight to this section. */
  id?: string;
  /**
   * Arrive on scroll. Only the narrative surfaces set this: a section of a
   * working table should already be there when the reader gets to it.
   */
  reveal?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-[calc(var(--header-h)+1rem)] ${reveal ? "amr-rise mb-12" : "mb-12"}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-rule-soft pb-2">
        <h2 className="m-0 font-display text-[clamp(19px,2vw,26px)] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {note ? <p className="m-0 font-mono text-[11px] text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * One counted figure and its meaning.
 *
 * `note` is optional plain-language context ("49,647 medicine links"). The SQL
 * behind each figure used to be printed here; it was taken off the page because
 * readers are not querying the database. Every figure is still traceable — to
 * the named query in `src/lib/queries` that produced it — and none is typed in.
 */
export function KPI({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="border-t border-rule-strong pt-3">
      <p className="m-0 font-mono text-[clamp(20px,2.2vw,30px)] font-medium tabular-nums leading-none text-ink">
        {value}
      </p>
      <p className="m-0 mt-2 text-[13px] leading-snug text-ink-2">{label}</p>
      {note ? <p className="m-0 mt-1.5 font-mono text-[10px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Callouts                                                            */
/* ------------------------------------------------------------------ */

/**
 * A limitation stated next to the thing it limits.
 *
 * Deliberately not collected into a footer: a limitation a reader has to go
 * looking for is a limitation the page did not really make.
 */
export function LimitationCallout({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className="rounded-card border border-rule bg-raised p-4"
      style={{ borderLeft: "2px solid var(--color-none)" }}
    >
      {title ? (
        <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-none">
          {title}
        </p>
      ) : null}
      <div className="max-w-[68ch] break-words text-[13px] leading-relaxed text-ink-2">{children}</div>
    </aside>
  );
}

export function WarningCallout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <aside
      className="rounded-card border border-rule bg-raised p-4"
      style={{ borderLeft: "2px solid var(--color-rose)" }}
      role="note"
    >
      <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-rose">
        {title}
      </p>
      <div className="max-w-[68ch] break-words text-[13px] leading-relaxed text-ink-2">{children}</div>
    </aside>
  );
}

/** Where a figure came from: the dataset, model and query behind it. */
export function ProvenanceBlock({ rows }: { rows: [string, string | null][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-rule pt-3">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
            {term}
          </dt>
          <dd className="m-0 break-words font-mono text-[11px] text-ink-2">
            {value ?? "unavailable"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-card border border-dashed border-rule-strong bg-raised px-6 py-12 text-center">
      <p className="m-0 font-display text-[15px] font-semibold text-ink">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-2">
          {children}
        </div>
      ) : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-5 inline-flex min-h-11 items-center rounded-card border border-ink px-4 font-display text-[13px] text-ink no-underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-rule bg-raised p-6"
      style={{ borderLeft: "2px solid var(--color-rose)" }}
    >
      <p className="m-0 font-display text-[15px] font-semibold text-ink">{title}</p>
      {detail ? (
        <p className="m-0 mt-2 max-w-[60ch] font-mono text-[12px] leading-relaxed text-ink-2">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/** Skeleton rows sized to the table they stand in for. */
export function LoadingState({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="border-t border-rule">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-rule-soft px-3 py-4">
          <div className="h-3 w-[28%] bg-sunken" />
          <div className="h-3 w-[14%] bg-sunken" />
          <div className="h-3 w-[18%] bg-sunken" />
          <div className="h-3 w-[12%] bg-sunken" />
        </div>
      ))}
    </div>
  );
}

/**
 * Shown when a surface can render some of its data but not all of it. Naming
 * what is missing keeps a partial page from reading as a complete one.
 */
export function PartialState({ missing }: { missing: string }) {
  return (
    <p
      className="m-0 border-l-2 pl-3 text-[12px] leading-relaxed text-muted"
      style={{ borderColor: "var(--color-unchecked)" }}
    >
      Partial view: {missing}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-GB");
}

/**
 * A stored value, or an em dash. Never a zero standing in for a missing
 * measurement — those are different statements.
 */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
