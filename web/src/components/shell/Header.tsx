"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { Mark } from "./Mark";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * Identity, the two places to start, and the search once the reader is
 * investigating. The overview and the dashboard carry their own search.
 */
export function Header() {
  const pathname = usePathname();
  const investigating = pathname.startsWith("/investigate");

  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      className="sticky top-0 z-40 border-b border-rule bg-[rgba(246,244,239,0.94)] backdrop-blur-[8px]"
    >
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-8 lg:px-12">
        <Link href="/" aria-label="AMR Drug Repurposing — overview" className="flex min-h-11 items-center gap-3 no-underline">
          <Mark size={28} />
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
            AMR Drug Repurposing
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => {
            const on = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-card px-3 font-display text-[14px] font-medium no-underline ${
                  on ? "text-ink underline decoration-accent decoration-2 underline-offset-[6px]" : "text-ink-2 hover-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {investigating ? (
          <div className="min-w-0 flex-1 basis-[320px] lg:ml-auto lg:max-w-[620px]">
            <InvestigateSearch compact />
          </div>
        ) : null}
      </div>
    </header>
  );
}
