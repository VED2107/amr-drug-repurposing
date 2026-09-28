"use client";

import Link from "next/link";

import { useEffect } from "react";

/**
 * What a reader sees when a page cannot be rendered.
 *
 * The default is an opaque host error page with a numeric id, which tells a
 * reader nothing and tells whoever has to fix it almost nothing. This says what
 * failed and what it does *not* mean — because on a site whose subject is
 * evidence, an unreachable database must never be mistaken for an absence of
 * evidence.
 *
 * Nothing is substituted. No cached figure, no placeholder, no last-known
 * value: the page that could not be built is simply not shown.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to the host's function log, where the full stack is available.
    console.error("page render failed", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-shell px-4 py-16 md:px-8 md:py-24 lg:px-12">
      <div className="max-w-[68ch]">
        <p className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          This page could not be loaded
        </p>
        <h1 className="m-0 font-display text-[clamp(26px,3vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          The data behind this page is not reachable right now.
        </h1>

        <p className="m-0 mt-5 text-[15px] leading-relaxed text-ink-2">
          Every figure on this site is read from the dataset when the page is
          requested. That read did not succeed, so nothing is shown — rather than showing
          a stale or substituted number.
        </p>

        <p
          className="m-0 mt-5 bg-raised px-4 py-4 text-[13px] leading-relaxed text-ink-2"
          style={{ borderLeft: "2px solid var(--color-none)" }}
        >
          This is a failure to <em>reach</em> the evidence. It is not a statement that
          there is no evidence, and it says nothing about any medicine.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="amr-btn"
          >
            Try again
          </button>
          <Link href="/" className="amr-btn-quiet">
            Back to the dashboard
          </Link>
        </div>

      </div>
    </main>
  );
}
