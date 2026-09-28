/**
 * The evidence marks, drawn rather than typed.
 *
 * Each kind of statement has its own shape as well as its own colour, so the
 * difference survives greyscale, colour-blindness and print:
 *
 *   clinical        filled diamond      a registered human study
 *   experimental    filled square       a laboratory measurement
 *   computational   open triangle       a model output; nothing measured
 *   none            open circle         searched, nothing found
 *   unchecked       dash                not yet searched
 *
 * One stroke weight (1.5) and one box (16) throughout.
 */

export type EvidenceKind = "clinical" | "experimental" | "computational" | "none" | "unchecked";

const COLOR: Record<EvidenceKind, string> = {
  clinical: "var(--color-clinical)",
  experimental: "var(--color-experimental)",
  computational: "var(--color-computational)",
  none: "var(--color-none)",
  unchecked: "var(--color-unchecked)",
};

export function EvidenceIcon({ kind, size = 14 }: { kind: EvidenceKind; size?: number }) {
  const color = COLOR[kind];
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="shrink-0"
      style={{ color }}
    >
      {kind === "clinical" ? <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" /> : null}
      {kind === "experimental" ? <rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" /> : null}
      {kind === "computational" ? (
        <path
          d="M8 2.2 14.2 13.3H1.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ) : null}
      {kind === "none" ? (
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : null}
      {kind === "unchecked" ? (
        <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
