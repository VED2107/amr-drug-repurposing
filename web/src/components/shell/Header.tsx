"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { Mark } from "./Mark";

/**
 * Identity, and the search once the reader has left the dashboard.
 *
 * There is no menu: the site is the dashboard and the investigation view, and
 * the search is how one gets from the first to the second.
 */
export function Header() {
  const pathname = usePathname();
  const home = pathname === "/";

  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      className="sticky top-0 z-40 border-b border-rule bg-[rgba(246,244,239,0.94)] backdrop-blur-[8px]"
    >
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8 lg:px-12">
        <Link href="/" aria-label="AMR Drug Repurposing — dashboard" className="flex min-h-11 items-center gap-3 no-underline">
          <Mark size={28} />
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
            AMR Drug Repurposing
          </span>
        </Link>
        {home ? null : (
          <div className="min-w-0 flex-1 basis-[320px] lg:max-w-[640px] lg:ml-auto">
            <InvestigateSearch compact />
          </div>
        )}
      </div>
    </header>
  );
}
