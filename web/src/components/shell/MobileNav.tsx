"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { APP_NAV, isAppRoute } from "@/lib/nav";

/** The four surfaces a phone user reaches for, plus a way to everything else. */
const PRIMARY = [
  { href: "/dashboard", label: "Overview" },
  { href: "/screening", label: "Screen" },
  { href: "/candidates", label: "Matrix" },
  { href: "/medicines", label: "Medicines" },
] as const;

/**
 * Bottom navigation, phones only.
 *
 * On a wide screen the grouped section nav in the header is scannable; on a
 * phone it is a horizontal scroller holding fourteen destinations, which is a
 * list you have to drag through before you can read it. This replaces it below
 * 768px with four fixed destinations and one sheet holding the rest.
 *
 * Four rules it keeps: every target is at least 44px tall, the current
 * destination is marked with `aria-current` as well as with weight, the bar
 * clears the home indicator via `safe-area-inset-bottom`, and the sheet closes
 * on route change so a tap never leaves it hanging open over the new page.
 */
export function MobileNav() {
  const pathname = usePathname();
  const sheetId = useId();
  /*
    The sheet remembers which route it was opened on rather than being closed
    by an effect after the route changes. Navigating therefore closes it in the
    same render as the new page appears — no frame where the menu covers the
    thing it just opened, and no cascading state update.
  */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isAppRoute(pathname)) return null;

  const isCurrent = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {open ? (
        <div
          id={sheetId}
          role="dialog"
          aria-modal="true"
          aria-label="All dashboard sections"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[72dvh] overflow-y-auto border-t border-rule-strong bg-raised md:hidden"
          style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              All sections
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-mono text-[11px] text-ink"
            >
              Close
            </button>
          </div>

          {APP_NAV.map((group) => (
            <section key={group.label} className="border-b border-rule-soft px-4 py-3">
              <p className="m-0 mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fainter">
                {group.label}
              </p>
              <ul className="m-0 list-none p-0">
                {group.items.map((item) => (
                  <li key={item.href} className="list-none">
                    <Link
                      href={item.href}
                      aria-current={isCurrent(item.href) ? "page" : undefined}
                      className="flex min-h-11 items-center font-display text-[15px] no-underline"
                      style={{
                        color: isCurrent(item.href) ? "var(--color-ink)" : "var(--color-ink-2)",
                        fontWeight: isCurrent(item.href) ? 600 : 400,
                      }}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      <nav
        aria-label="Dashboard sections"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule-strong bg-[rgba(255,253,248,0.96)] backdrop-blur-[10px] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="m-0 flex list-none items-stretch p-0">
          {PRIMARY.map((item) => {
            const current = isCurrent(item.href);
            return (
              <li key={item.href} className="flex-1 list-none">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className="flex min-h-[3.25rem] flex-col items-center justify-center gap-1 px-1 no-underline"
                  style={{ color: current ? "var(--color-ink)" : "var(--color-muted)" }}
                >
                  {/* A rule, not an icon: this design has no icon set, and an
                      emoji would be neither consistent nor themeable. */}
                  <span
                    aria-hidden="true"
                    className="block h-[2px] w-5"
                    style={{
                      background: current ? "var(--color-accent)" : "transparent",
                    }}
                  />
                  <span
                    className="font-display text-[11px] leading-none"
                    style={{ fontWeight: current ? 600 : 400 }}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1 list-none">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={sheetId}
              className="flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-1 px-1"
              style={{ color: open ? "var(--color-ink)" : "var(--color-muted)" }}
            >
              <span
                aria-hidden="true"
                className="block h-[2px] w-5"
                style={{ background: open ? "var(--color-accent)" : "transparent" }}
              />
              <span
                className="font-display text-[11px] leading-none"
                style={{ fontWeight: open ? 600 : 400 }}
              >
                More
              </span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
