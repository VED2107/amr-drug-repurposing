/**
 * A decorative strip under the headline: a shelf of capsules, all at rest but
 * one, which turns to a new angle in the accent colour. Old medicines, a new
 * question. It counts nothing and stands for no figure; it is ornament, so it
 * is hidden from assistive technology. With reduced motion it is simply drawn.
 */

/* Fixed tilts (degrees) so server and client render the same shelf. */
const TILTS = [0, -6, 4, -3, 8, -5, 2, 0, -7, 5, -2, 6, -4];
const TURNED = 7;
const STEP = 46;

export function HeroMotif() {
  const width = TILTS.length * STEP;
  return (
    <svg
      viewBox={`0 0 ${width} 48`}
      preserveAspectRatio="xMinYMid meet"
      className="amr-motif block h-12 w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* The shelf the capsules rest on. */}
      <path className="amr-motif-shelf" pathLength={1} d={`M0 38.5 H${width}`} stroke="var(--color-rule)" strokeWidth="1" />
      {TILTS.map((tilt, i) => {
        const cx = i * STEP + STEP / 2;
        const turned = i === TURNED;
        return (
          <g
            key={i}
            className={`amr-motif-cap${turned ? " is-turned" : ""}`}
            style={{ ["--i" as string]: i, ["--tilt" as string]: `${tilt}deg` }}
          >
            <g transform={`translate(${cx - 17} 22)`}>
              <path
                d="M17 1 h8 a8 8 0 0 1 0 16 H17 Z"
                fill={turned ? "var(--color-accent)" : "#f5e6d8"}
                opacity={turned ? 1 : 0.55}
              />
              <rect
                x="1"
                y="1"
                width="32"
                height="16"
                rx="8"
                fill="none"
                stroke={turned ? "var(--color-accent)" : "var(--color-ink-2)"}
                strokeWidth={turned ? 1.6 : 1.2}
              />
              <path d="M17 1 V17" stroke={turned ? "var(--color-accent)" : "var(--color-ink-2)"} strokeWidth={turned ? 1.6 : 1.2} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
