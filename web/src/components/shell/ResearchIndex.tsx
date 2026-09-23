"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { APP_NAV, isCurrent, locate } from "@/lib/nav";
import type { Readout, Readouts } from "@/lib/queries/nav";

/**
 * The research index: the application's navigation, set as the table of
 * contents of a lab notebook rather than as a menu.
 *
 * Sections are numbered in the order evidence is built and hang from one
 * hairline spine. The current page is marked on the spine in ochre and its
 * stage turns ink. Beside an entry, the live figure for the thing it leads to;
 * under the entries whose coverage can be measured, a hairline gauge of how much
 * of their universe has been covered. Read down the index and you see where the
 * evidence runs out before opening a page.
 *
 * Two widths on a wide screen. Open, it is the full index. Collapsed, it is the
 * spine alone: every page keeps its tick, the stage numbers stay, the gauges
 * shrink to their first few pixels, and hovering or focusing a tick names it.
 * The page list never disappears; only the words fold away.
 *
 * The one thing that moves: the ochre marker. The index persists across page
 * changes, so on navigation the marker travels along the spine from the entry
 * you left to the entry you opened. It is a single element moved by
 * `transform`, and under reduced motion it simply appears in its new place.
 */
export function ResearchIndex({
  readouts,
  compact = false,
  collapsed = false,
  onToggle,
}: {
  readouts: Readouts;
  /** The phone sheet: larger targets, no provenance footer duplication. */
  compact?: boolean;
  /** The wide-screen rail folded to its spine. */
  collapsed?: boolean;
  /** Present on the wide-screen rail only. */
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const here = locate(pathname);
  const listRef = useRef<HTMLOListElement>(null);
  const [marker, setMarker] = useState<{ y: number; h: number; ready: boolean } | null>(null);

  /*
    Measure the current entry and move the marker to it. Measured before paint
    so it never draws in the wrong place; the transition is enabled only after
    the first placement, so a page load does not slide the marker in from the
    top. Re-measured when the index resizes: fonts arriving, the sheet opening,
    the rail folding.
  */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const place = () => {
      const target = list.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!target) {
        setMarker(null);
        return;
      }
      const listBox = list.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const h = Math.min(22, box.height - 14);
      setMarker((prev) => ({
        y: box.top - listBox.top + (box.height - h) / 2,
        h,
        ready: prev !== null,
      }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname, collapsed]);

  return (
    <nav aria-label="Research index" className="flex min-h-full flex-col">
      <div className="mb-5">
        <div className="flex items-center justify-between gap-2">
          {!collapsed ? (
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Research index</p>
          ) : null}
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-keyshortcuts="["
              title={collapsed ? "Show the research index  [" : "Hide the research index  ["}
              className="hover-ink -mr-1.5 inline-flex min-h-9 items-center gap-1.5 px-1.5 font-mono text-[10px] text-muted"
            >
              {collapsed ? "Show" : "Hide"}
              <kbd className="border border-rule px-1 font-mono text-[9px] leading-[14px] text-faint">[</kbd>
            </button>
          ) : null}
        </div>
      </div>

      <ol ref={listRef} className={`relative m-0 list-none p-0 ${collapsed ? "space-y-3" : "space-y-5"}`}>
        {marker ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[3px] top-0 z-10 w-[5px] bg-accent motion-safe:transition-[transform,height] motion-safe:duration-[280ms] motion-safe:ease-[cubic-bezier(0.77,0,0.175,1)]"
            style={{
              height: marker.h,
              transform: `translate3d(0, ${marker.y}px, 0)`,
              transitionProperty: marker.ready ? undefined : "none",
            }}
          />
        ) : null}

        {APP_NAV.map((group) => {
          const groupIsHere = here?.group.label === group.label;
          return (
            <li key={group.label}>
              <p
                className="m-0 mb-1 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-300"
                style={{ color: groupIsHere ? "var(--color-ink)" : "var(--color-faint)" }}
              >
                <span
                  className="tabular-nums transition-colors duration-300"
                  style={{ color: groupIsHere ? "var(--color-accent)" : undefined }}
                >
                  {group.n ?? "··"}
                </span>
                {collapsed ? <span className="sr-only">{group.label}</span> : <span>{group.label}</span>}
              </p>

              <ul className="relative m-0 list-none p-0">
                {/* The spine. Ink along the stage you are in, rule elsewhere. */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-2 left-[5px] top-2 w-px transition-colors duration-500"
                  style={{ background: groupIsHere ? "var(--color-ink)" : "var(--color-rule)" }}
                />
                {group.items.map((item) => {
                  const current = isCurrent(item, pathname);
                  const readout = item.readout ? readouts[item.readout] : undefined;
                  return (
                    <li key={item.href} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute left-[5px] top-1/2 h-px -translate-y-1/2 transition-colors duration-500"
                        style={{
                          width: collapsed ? 12 : 7,
                          background: groupIsHere ? "var(--color-ink)" : "var(--color-rule-strong)",
                        }}
                      />
                      {collapsed ? (
                        <SpineLink item={item} current={current} readout={readout} />
                      ) : (
                        <Link
                          href={item.href}
                          aria-current={current ? "page" : undefined}
                          className={`hover-ink grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 pl-5 no-underline transition-colors duration-300 ${
                            compact ? "min-h-12 py-2.5" : "min-h-11 py-2"
                          }`}
                          style={{ color: current ? "var(--color-ink)" : "var(--color-ink-2)" }}
                        >
                          <span
                            className={`min-w-0 font-display leading-snug ${compact ? "text-[16px]" : "text-[14px]"}`}
                            style={{ fontWeight: current ? 600 : 400 }}
                          >
                            {item.label}
                          </span>
                          {readout ? (
                            <span
                              className="font-mono text-[10px] tabular-nums"
                              style={{
                                color: item.readout === "future" ? "var(--color-rose)" : "var(--color-muted)",
                              }}
                            >
                              <span aria-hidden="true">{readout.text}</span>
                              <span className="sr-only">, {readout.spoken}</span>
                            </span>
                          ) : null}
                          {readout?.gauge ? <Gauge gauge={readout.gauge} className="col-span-2 mt-1.5" /> : null}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>

      {!collapsed && !compact ? (
        <div className="mt-auto border-t border-rule pt-2">
          <Link href="/" className="inline-flex min-h-11 items-center font-display text-[13px]">
            ← Overview
          </Link>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * One entry on the folded spine: a tick, the first pixels of its gauge, and a
 * label that flies out on hover or keyboard focus.
 *
 * The label waits a quarter of a second the first time, so a pointer passing
 * over the rail does not set off a row of flyouts; once one has shown, the rail
 * is marked warm and moving along the spine shows the next at once, until the
 * pointer leaves the rail (see `AppFrame`).
 */
function SpineLink({
  item,
  current,
  readout,
}: {
  item: { href: string; label: string };
  current: boolean;
  readout: Readout | undefined;
}) {
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      aria-label={readout ? `${item.label}, ${readout.spoken}` : item.label}
      className="amr-spine-link group relative flex min-h-10 flex-col justify-center pl-[22px] no-underline"
    >
      {readout?.gauge ? <Gauge gauge={readout.gauge} className="w-5" /> : null}
      <span
        aria-hidden="true"
        className="amr-spine-flyout pointer-events-none absolute left-full top-1/2 z-30 ml-3 whitespace-nowrap border border-rule-strong bg-raised px-2.5 py-1.5 shadow-[0_6px_18px_rgba(18,19,15,0.10)]"
      >
        <span className="font-display text-[13px] text-ink" style={{ fontWeight: current ? 600 : 400 }}>
          {item.label}
        </span>
        {readout ? (
          <span
            className="ml-2.5 font-mono text-[10px] tabular-nums"
            style={{ color: readout.gauge?.tone === "none" ? "var(--color-rose)" : "var(--color-muted)" }}
          >
            {readout.text}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

const TONE: Record<NonNullable<Readout["gauge"]>["tone"], string> = {
  clinical: "var(--color-clinical)",
  computational: "var(--color-computational)",
  ink: "var(--color-ink-2)",
  none: "var(--color-none)",
};

/**
 * A coverage gauge: a 3px track, filled to the covered share. Decorative to
 * assistive technology; the fraction is printed beside it and spoken in full.
 * An empty universe ("not built") is drawn as a dashed rule, not an empty bar,
 * because nothing was measured there.
 */
export function Gauge({ gauge, className = "" }: { gauge: NonNullable<Readout["gauge"]>; className?: string }) {
  if (gauge.tone === "none") {
    return <span aria-hidden="true" className={`block border-t border-dashed border-rule-strong ${className}`} />;
  }
  const share = gauge.of > 0 ? Math.min(100, (gauge.done / gauge.of) * 100) : 0;
  return (
    <span aria-hidden="true" className={`relative block h-[3px] bg-rule-soft ${className}`}>
      <span
        className="absolute inset-y-0 left-0 motion-safe:transition-[width,background-color] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          width: gauge.done > 0 ? `max(${share}%, 2px)` : "0",
          background: TONE[gauge.tone],
        }}
      />
    </span>
  );
}
