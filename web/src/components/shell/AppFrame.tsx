"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { isAppRoute } from "@/lib/nav";
import type { Readouts } from "@/lib/queries/nav";
import { ResearchIndex } from "./ResearchIndex";
import { MobileIndex } from "./MobileIndex";

const STORAGE_KEY = "amr-index-collapsed";

/*
  The folded/open preference as a tiny external store over localStorage, read
  with useSyncExternalStore: the server renders the rail open, the client picks
  up the saved choice on hydration, and nothing sets state inside an effect. If
  storage is blocked the choice still applies for this page's lifetime.
*/
const listeners = new Set<() => void>();
let remembered: boolean | null = null;

function readCollapsed(): boolean {
  if (remembered === null) {
    try {
      remembered = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      remembered = false;
    }
  }
  return remembered;
}

function writeCollapsed(next: boolean) {
  remembered = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* not persisted; still applied */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The application frame: the research index on the left, the page beside it.
 *
 * The narrative Overview (`/`) is set full width with no index. It is read, not
 * navigated. Every other route carries the index: as a sticky rail from 1024px,
 * and below that as the location bar and sheet in `MobileIndex`.
 *
 * The rail folds to its spine and back: the Hide control, or the `[` key. A
 * click animates the column width over 220ms; the key switches instantly,
 * because a keyboard action repeated many times a day should never wait on an
 * animation. The choice is remembered in this browser only; if storage is
 * unavailable the rail simply opens each time.
 */
export function AppFrame({
  children,
  footer,
  readouts,
  dataVersion,
}: {
  children: ReactNode;
  footer: ReactNode;
  readouts: Readouts;
  dataVersion: string | null;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [instant, setInstant] = useState(true);
  const railRef = useRef<HTMLDivElement>(null);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The saved choice is applied at hydration without animating; widths animate
  // only from the first frame after that.
  useEffect(() => {
    const id = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(id);
  }, []);

  const apply = (next: boolean, viaKeyboard: boolean) => {
    setInstant(viaKeyboard);
    writeCollapsed(next);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setInstant(true);
      writeCollapsed(!readCollapsed());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /*
    Flyout warmth on the folded spine: once a label has been showing for the
    first delay, later labels appear without it, until the pointer leaves.
  */
  const onRailOver = (event: React.MouseEvent) => {
    if (!collapsed || railRef.current?.dataset.warm !== undefined) return;
    if (!(event.target as HTMLElement).closest(".amr-spine-link")) return;
    if (warmTimer.current) return;
    warmTimer.current = setTimeout(() => {
      if (railRef.current) railRef.current.dataset.warm = "";
    }, 260);
  };
  const onRailLeave = () => {
    if (warmTimer.current) clearTimeout(warmTimer.current);
    warmTimer.current = null;
    if (railRef.current) delete railRef.current.dataset.warm;
  };

  if (!isAppRoute(pathname)) {
    return (
      <>
        <main id="main" className="flex-1">
          {children}
        </main>
        {footer}
      </>
    );
  }

  return (
    <>
      <div
        className="flex-1 lg:grid lg:grid-cols-[var(--rail-w)_minmax(0,1fr)]"
        style={
          {
            "--rail-w": collapsed ? "4.25rem" : "17rem",
            transition: instant ? "none" : "grid-template-columns 220ms cubic-bezier(0.23, 1, 0.32, 1)",
          } as React.CSSProperties
        }
      >
        <div
          ref={railRef}
          onMouseOver={onRailOver}
          onMouseLeave={onRailLeave}
          style={{ viewTransitionName: "site-rail" }}
          className="relative z-20 hidden border-r border-rule lg:block"
        >
          <div
            className={`sticky top-[var(--header-h)] h-[calc(100dvh-var(--header-h))] py-8 ${
              collapsed ? "overflow-visible pl-4 pr-2" : "overflow-y-auto px-6 xl:px-7"
            }`}
          >
            <ResearchIndex
              readouts={readouts}
              dataVersion={dataVersion}
              collapsed={collapsed}
              onToggle={() => apply(!collapsed, false)}
            />
          </div>
        </div>
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
      {footer}
      {/* Below 1024px the location bar is fixed to the bottom edge; this keeps
          the end of the footer clear of it. */}
      <div aria-hidden="true" className="h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:hidden" />
      <MobileIndex readouts={readouts} dataVersion={dataVersion} />
    </>
  );
}
