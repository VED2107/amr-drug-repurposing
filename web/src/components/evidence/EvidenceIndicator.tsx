import { RUNGS, rung } from "@/lib/science";
import type { EvidenceRung } from "@/lib/types";

/**
 * A single evidence rung as a badge.
 *
 * Carries a glyph as well as a colour so the meaning survives greyscale,
 * colour-blindness and a printed page. The label is always spelled out; the
 * glyph is decoration on top of text, never a replacement for it.
 */
export function EvidenceIndicator({
  value,
  size = "md",
}: {
  value: EvidenceRung;
  size?: "sm" | "md";
}) {
  const r = rung(value);
  const small = size === "sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-card border px-2 py-1 font-mono uppercase tracking-[0.08em] ${
        small ? "text-[9px]" : "text-[10px]"
      }`}
      style={{ color: r.colorVar, borderColor: "var(--color-rule)" }}
    >
      <span aria-hidden="true">{r.glyph}</span>
      {r.label}
    </span>
  );
}

/**
 * The full five-rung ladder, with what each rung does and does not establish.
 *
 * The "not" line is not a footnote: it sits with the rung because a page that
 * only says what happened at each step reads as a chain of proof.
 */
export function EvidenceLadder({ active }: { active?: EvidenceRung }) {
  return (
    <ul className="m-0 list-none border-t border-rule p-0">
      {RUNGS.map((r) => {
        const isActive = active === r.key;
        return (
          <li
            key={r.key}
            className="border-b border-rule-soft px-3 py-3.5"
            style={{
              background: isActive ? "var(--color-raised)" : "transparent",
              borderLeft: isActive ? `2px solid ${r.colorVar}` : "2px solid transparent",
            }}
            aria-current={isActive ? "true" : undefined}
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" style={{ color: r.colorVar }}>
                {r.glyph}
              </span>
              <span
                className="font-display text-[13px] font-semibold"
                style={{ color: isActive ? "var(--color-ink)" : "var(--color-ink-2)" }}
              >
                {r.label}
              </span>
              {isActive ? (
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
                  this pairing
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-1.5 max-w-[68ch] text-[12px] leading-relaxed text-ink-2">
              {r.means}
            </p>
            <p className="m-0 mt-1 max-w-[68ch] text-[12px] leading-relaxed text-muted">
              {r.not}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
