"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAV, TOP_NAV, isAppRoute } from "@/lib/nav";
import { SearchField } from "@/components/search/SearchField";

/**
 * Sticky header: identity, global search, primary nav, and — inside the app —
 * the grouped section nav.
 *
 * The nav is a horizontal scroller rather than a hamburger on small screens.
 * A researcher scanning sections benefits from seeing the group labels; hiding
 * six groups behind a toggle would cost more than the width it saves.
 */
export function Header({ snapshot }: { snapshot: string | null }) {
  const pathname = usePathname();
  const inApp = isAppRoute(pathname);

  return (
    <header
      // The reader's fixed reference point during a page transition: the
      // content slides, the chrome does not. See `::view-transition-group`
      // rules for `site-header` in globals.css.
      style={{ viewTransitionName: "site-header" }}
      className="sticky top-0 z-40 border-b border-rule bg-[rgba(246,244,239,0.92)] backdrop-blur-[8px]"
    >
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-3 px-4 py-3.5 sm:gap-6 md:px-8 lg:px-12">
        <Link
          href="/"
          aria-label="AMR Research — home"
          className="flex min-h-11 flex-col justify-center gap-0.5 no-underline"
        >
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
            AMR Research
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Smart Screening
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 basis-[220px] items-center justify-end gap-3.5">
          <GlobalSearch />
          {snapshot ? (
            <span className="hidden whitespace-nowrap font-mono text-[10px] text-muted sm:inline">
              DB {snapshot}
            </span>
          ) : null}
        </div>
      </div>

      <nav aria-label="Primary" className="border-t border-rule-soft">
        <div className="mx-auto flex max-w-shell gap-6 px-4 md:px-8 lg:px-12">
          {TOP_NAV.map((item) => {
            const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className="hover-ink inline-flex min-h-11 items-center whitespace-nowrap border-b-2 py-2.5 font-display text-[14px] no-underline"
                style={{
                  color: current ? "var(--color-ink)" : "var(--color-muted)",
                  borderBottomColor: current ? "var(--color-ink)" : "transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {inApp ? (
        <nav
          // Hidden on phones: MobileNav carries the same destinations there in
          // a form you can read without dragging a fourteen-item scroller.
          aria-label="Dashboard sections"
          className="scroll-x hidden border-t border-rule-soft bg-raised md:block"
        >
          <div className="mx-auto flex min-w-max max-w-shell gap-6 px-4 md:px-8 lg:px-12">
            {APP_NAV.map((group) => (
              <div key={group.label} className="flex items-center gap-3.5 py-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-fainter">
                  {group.label}
                </span>
                {group.items.map((item) => {
                  const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className="hover-ink inline-flex min-h-11 items-center whitespace-nowrap border-b-2 py-2.5 font-display text-[13px] no-underline"
                      style={{
                        color: current ? "var(--color-ink)" : "var(--color-muted)",
                        borderBottomColor: current ? "var(--color-ink)" : "transparent",
                      }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function GlobalSearch() {
  /*
    The header lookup is the same control the filter forms use, in its
    navigating mode: taking a suggestion opens that medicine rather than
    filling a field. Keeping one implementation means the suggestion list, the
    keyboard behaviour and the "nothing in this database matches" wording are
    the same everywhere.
  */
  return (
    <SearchField
      name="q"
      source="medicines"
      label="Search medicine or condition"
      placeholder="Search medicine or condition"
      navigate
      className="min-w-0 max-w-[340px] flex-1 basis-[200px]"
    />
  );
}
