import Link from "next/link";

import { withParams, type RawSearchParams } from "@/lib/url";

/**
 * Page controls that say what is being counted.
 *
 * The range is spelled out ("26–50 of 1,691 medicines") because a bare page
 * number hides how much of the library a reader has actually seen.
 */
export function Pagination({
  page,
  pageSize,
  total,
  path,
  params,
  unit,
  param = "page",
  anchor,
}: {
  page: number;
  pageSize: number;
  total: number;
  path: string;
  params: RawSearchParams;
  unit: string;
  /** The query parameter that holds this list's page, when a view has two lists. */
  param?: string;
  /** Section to land on after paging, so the reader is not sent to the top. */
  anchor?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const link = (target: number, label: string, disabled: boolean) =>
    disabled ? (
      <span
        aria-disabled="true"
        className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-mono text-[11px] text-fainter"
      >
        {label}
      </span>
    ) : (
      <Link
        href={`${withParams(path, params, { [param]: target })}${anchor ? `#${anchor}` : ""}`}
        className="inline-flex min-h-11 items-center rounded-card border border-rule-strong px-3 font-mono text-[11px] text-ink no-underline hover-ink"
      >
        {label}
      </Link>
    );

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="m-0 font-mono text-[11px] tabular-nums text-muted">
        {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of{" "}
        {total.toLocaleString("en-GB")} {unit}
      </p>
      <div className="flex items-center gap-2">
        {link(page - 1, "← Previous", page <= 1)}
        <span className="font-mono text-[11px] tabular-nums text-muted">
          page {page} / {pages}
        </span>
        {link(page + 1, "Next →", page >= pages)}
      </div>
    </nav>
  );
}
