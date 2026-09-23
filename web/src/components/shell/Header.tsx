"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAppRoute } from "@/lib/nav";
import { SearchField } from "@/components/search/SearchField";
import { Mark } from "./Mark";

/**
 * Sticky header: identity, global search and the database date — nothing else.
 *
 * Navigation inside the application lives in the research index (the left rail,
 * or the location bar on a phone), so the header no longer carries rows of
 * links. On the narrative Overview, which has no index, it offers the one way
 * in: the Dashboard.
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
      className="sticky top-0 z-40 border-b border-rule bg-[rgba(246,244,239,0.94)] backdrop-blur-[8px]"
    >
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 md:px-8 lg:px-6 xl:px-7">
        <Link
          href="/"
          aria-label="AMR Research — Overview"
          className="flex min-h-11 items-center gap-3 no-underline"
        >
          <Mark size={30} />
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
              AMR Research
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Smart Screening
            </span>
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 basis-[220px] items-center justify-end gap-4">
          <SearchField
            name="q"
            source="medicines"
            label="Search medicine or condition"
            placeholder="Search medicine or condition"
            navigate
            className="min-w-0 max-w-[380px] flex-1 basis-[200px]"
          />
          {snapshot ? (
            <span className="hidden whitespace-nowrap font-mono text-[10px] text-muted sm:inline">
              DB {snapshot}
            </span>
          ) : null}
          {!inApp ? (
            <Link
              href="/dashboard"
              className="amr-btn-quiet"
            >
              Dashboard <span data-arrow aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
