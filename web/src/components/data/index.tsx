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

  const arrow = (dir: "prev" | "next") => (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const link = (target: number, dir: "prev" | "next", disabled: boolean) => {
    const label = dir === "prev" ? "Previous page" : "Next page";
    return disabled ? (
      <span aria-disabled="true" aria-label={label} className="amr-page-btn" data-disabled="">
        {arrow(dir)}
      </span>
    ) : (
      <Link
        href={`${withParams(path, params, { [param]: target })}${anchor ? `#${anchor}` : ""}`}
        aria-label={label}
        className="amr-page-btn"
      >
        {arrow(dir)}
      </Link>
    );
  };

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 font-mono text-[11px] tabular-nums text-muted">
        {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of{" "}
        {total.toLocaleString("en-GB")} {unit}
      </p>
      <div className="amr-pager inline-flex items-center gap-1 rounded-full border border-rule bg-raised p-1">
        {link(page - 1, "prev", page <= 1)}
        <span className="flex min-w-[7.5rem] flex-col items-center px-2">
          <span className="font-mono text-[11px] tabular-nums text-ink">
            Page {page.toLocaleString("en-GB")} <span className="text-muted">of {pages.toLocaleString("en-GB")}</span>
          </span>
          {/* Where this page sits in the list. */}
          <span aria-hidden="true" className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max(4, (page / pages) * 100)}%` }}
            />
          </span>
        </span>
        {link(page + 1, "next", page >= pages)}
      </div>
    </nav>
  );
}
