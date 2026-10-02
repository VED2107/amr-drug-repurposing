/**
 * The four cell cross-sections from slide 5 of the presentation, redrawn as
 * SVG (used small, in the species selector).
 *
 * Ink outlines at one weight, paper and sunken fills, ochre for the
 * resistance feature. Schematic and not to scale; each use says so.
 */

import type { PathogenKey } from "@/lib/types";

const INK = "var(--color-ink)";
const RULE = "var(--color-rule-strong)";
const OCHRE = "var(--color-accent)";

/* ------------------------------------------------------------------ */
/* Slide 5: four cell cross-sections, the resistance feature in ochre  */
/* ------------------------------------------------------------------ */

export function OrganismCell({ pathogen, size = 132 }: { pathogen: PathogenKey; size?: number }) {
  const ring = (r: number, stroke: string, width = 1.5, extra: Record<string, string> = {}) => (
    <circle cx="60" cy="60" r={r} fill="none" stroke={stroke} strokeWidth={width} {...extra} />
  );
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" className="amr-cell shrink-0">
      {pathogen === "mrsa" ? (
        <>
          {/* Thick Gram-positive wall; the altered target sits inside. */}
          <circle cx="60" cy="60" r="50" fill="var(--color-sunken)" stroke={INK} strokeWidth="1.5" />
          <circle cx="60" cy="60" r="39" fill="var(--color-raised)" stroke={INK} strokeWidth="1.5" />
          <rect className="amr-mark" x="54" y="28" width="11" height="11" fill={OCHRE} />
        </>
      ) : null}
      {pathogen === "ecoli" ? (
        <>
          {/* Outer membrane, then the inner membrane; a pump spans both. */}
          {ring(50, INK, 1.5)}
          {ring(46, RULE, 1.5)}
          {ring(41, INK, 1.5)}
          <rect className="amr-mark" x="94" y="54" width="18" height="12" fill={OCHRE} />
        </>
      ) : null}
      {pathogen === "kpneumoniae" ? (
        <>
          {/* Gram-negative envelope; carbapenemase enzymes sit in it. */}
          {ring(50, INK, 1.5)}
          {ring(46, RULE, 1.5)}
          {ring(41, INK, 1.5)}
          {[-84, 18, 128, 214].map((deg) => {
            const t = (deg * Math.PI) / 180;
            return (
              <circle
                key={deg}
                className="amr-mark"
                cx={r2(60 + 46 * Math.cos(t))}
                cy={r2(60 + 46 * Math.sin(t))}
                r="3.6"
                fill={OCHRE}
              />
            );
          })}
        </>
      ) : null}
      {pathogen === "mtb" ? (
        <>
          {/* A thick, waxy, mycolic-acid-rich envelope. */}
          <circle className="amr-mark" cx="60" cy="60" r="50" fill="var(--color-sunken)" stroke={OCHRE} strokeWidth="1.5" strokeDasharray="3.5 3" />
          <circle cx="60" cy="60" r="35" fill="var(--color-raised)" stroke={INK} strokeWidth="1.5" />
        </>
      ) : null}
    </svg>
  );
}

/** Two decimals: server and browser trig differ in the last digit. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
