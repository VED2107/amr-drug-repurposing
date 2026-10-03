"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { Mark } from "./Mark";

const BASE_NAV = [
  { href: "/", label: "Overview" },
  { href: "/dashboard", label: "Dashboard" },
];
/** Local-only: shown where the docking operations pages exist (see lib/dockingOps). */
const DOCKING_NAV = { href: "/docking", label: "Docking" };

/**
 * Identity, the two places to start, and the search once the reader is
 * investigating. The overview and the dashboard carry their own search.
 *
 * Built from the site's one action shape, the capsule: the brand sits in a
 * capsule chip with the mark, and the navigation is a capsule switch whose ink
 * pill slides to the page you are on. A hairline along the lower edge fills as
 * the page is read.
 */
export function Header({ showDocking = false }: { showDocking?: boolean }) {
  const NAV = showDocking ? [...BASE_NAV, DOCKING_NAV] : BASE_NAV;
  const pathname = usePathname();
  const investigating = pathname.startsWith("/investigate");
  const at = NAV.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      className="amr-header sticky top-0 z-40 border-b border-rule bg-[rgba(246,244,239,0.94)] backdrop-blur-[8px]"
    >
      <span aria-hidden="true" className="amr-progress" />
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:px-8 lg:px-12">
        <Link href="/" aria-label="AMR Drug Repurposing, Smart Screening: overview" className="amr-brand flex items-center gap-3 rounded-full no-underline">
          <Mark size={36} className="rounded-full" />
          <span className="flex flex-col pr-3 leading-none">
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
              AMR Drug Repurposing
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Smart Screening
              <span aria-hidden="true" className="h-px w-3 bg-rule-strong" />
              <span className="normal-case tracking-normal">research prototype</span>
            </span>
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="amr-navpill relative grid grid-cols-3 rounded-full"
          style={{ ["--at" as string]: Math.max(at, 0), ["--n" as string]: NAV.length }}
          data-none={at < 0 ? "" : undefined}
        >
          <span aria-hidden="true" className="amr-navpill-ink" />
          {NAV.map((item) => {
            const on = NAV[at]?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className="amr-navlink relative z-[1] inline-flex min-h-10 items-center justify-center rounded-full px-4 font-display text-[13px] font-semibold no-underline"
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {investigating ? (
          <div className="min-w-0 flex-1 basis-[320px] lg:ml-auto lg:max-w-[640px]">
            <InvestigateSearch compact />
          </div>
        ) : null}
      </div>
    </header>
  );
}
