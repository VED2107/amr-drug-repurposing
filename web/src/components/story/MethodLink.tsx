import Link from "next/link";

/** The overview's way into the full method page (not in the main navigation). */
export function MethodLink() {
  return (
      <Link
      href="/methods"
      className="amr-deeper group flex flex-wrap items-center justify-between gap-4 rounded-card border border-ink bg-raised px-5 py-5 no-underline md:px-7"
    >
      <span>
        <span className="block font-display text-[18px] font-semibold text-ink">
          The method in full, and how to read a result
        </span>
        <span className="mt-1 block text-[14px] leading-snug text-ink-2">
          Every source and tool we used, the eight training steps, and what each kind of result does
          and does not mean.
        </span>
      </span>
      <span aria-hidden="true" className="amr-deeper-arrow font-mono text-[22px] text-accent">
        →
      </span>
    </Link>
  );
}
