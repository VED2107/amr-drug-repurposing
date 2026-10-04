import { EvidenceIcon } from "@/components/investigate/icons";
import type { TrainingFigures } from "@/lib/queries/story";
import { LABEL_ACTIVE_MICROMOLAR, LABEL_INACTIVE_MICROMOLAR } from "@/lib/science";
import { Reveal } from "./Reveal";

/**
 * How the models learned, in three pictures and two lists.
 *
 * 1. The potency ruler: how one published laboratory measurement becomes a
 *    label (active, inactive, or too close to call and left out).
 * 2. What each of the four models learned from, and how little of it was
 *    measured on a resistant strain.
 * 3. The learning step itself: labelled structures in, a pattern, and a new
 *    approved medicine's estimate against the 40% discovery filter.
 *
 * Every count is read live. No model names, metrics or internal identifiers:
 * the public pages never show the machinery.
 */
export function Training({ data, threshold }: { data: TrainingFigures; threshold: string }) {
  const n = (v: number) => v.toLocaleString("en-GB");
  const actives = data.perPathogen.reduce((a, p) => a + p.actives, 0);
  const inactives = data.perPathogen.reduce((a, p) => a + p.inactives, 0);
  const maxTotal = Math.max(1, ...data.perPathogen.map((p) => p.actives + p.inactives));

  return (
    <div className="flex flex-col gap-4">
      {/* 1 · The ruler ------------------------------------------------------ */}
      <Reveal className="amr-train rounded-card border border-rule bg-raised p-5 md:p-7">
        <StepHead n="1" title="Each laboratory measurement becomes a label">
          A record says how much of a molecule it took to stop the pathogen growing. Less is more
          potent.
        </StepHead>

        <div className="mt-6">
          <div className="grid grid-cols-[2fr_1fr_2fr] font-mono text-[11px] text-muted">
            <span>more potent</span>
            <span />
            <span className="text-right">less potent</span>
          </div>
          <div className="relative mt-2 grid grid-cols-[2fr_1fr_2fr] gap-px overflow-hidden rounded-card border border-rule bg-rule">
            <Zone
              tone="active"
              title="Active"
              rule={`stopped growth at ${LABEL_ACTIVE_MICROMOLAR} µM or less`}
              count={n(actives)}
            />
            <Zone tone="ambiguous" title="Too close to call" rule="left out of training" count={n(data.ambiguous)} />
            <Zone
              tone="inactive"
              title="Inactive"
              rule={`needed ${LABEL_INACTIVE_MICROMOLAR} µM or more`}
              count={n(inactives)}
            />
          </div>
          <div className="relative mt-1 grid grid-cols-[2fr_1fr_2fr] font-mono text-[11px] text-ink-2">
            <span />
            <span className="flex justify-between">
              <span className="-translate-x-1/2">{LABEL_ACTIVE_MICROMOLAR} µM</span>
              <span className="translate-x-1/2">{LABEL_INACTIVE_MICROMOLAR} µM</span>
            </span>
            <span />
          </div>
        </div>
        <p className="m-0 mt-4 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          Records in the middle are not forced into a yes or no. Leaving them out keeps borderline
          chemistry from teaching the model either way.
        </p>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 2 · Per pathogen -------------------------------------------------- */}
        <Reveal className="amr-train rounded-card border border-rule bg-raised p-5 md:p-7">
          <StepHead n="2" title="One model per pathogen, each with its own records">
            The bar is every labelled record for that species. The ochre line beneath is the share
            measured on a named resistant strain.
          </StepHead>
          <ul className="m-0 mt-6 flex list-none flex-col gap-5 p-0">
            {data.perPathogen.map((p, i) => {
              const total = p.actives + p.inactives;
              const share = total ? (p.resistant / total) * 100 : 0;
              return (
                <li key={p.key} style={{ ["--i" as string]: i }} className="amr-train-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={`font-display text-[16px] font-semibold text-ink ${p.key === "mrsa" ? "" : "italic"}`}>
                      {p.label}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted">
                      {n(p.actives)} active · {n(p.inactives)} inactive
                    </span>
                  </div>
                  <div className="mt-2 flex h-3" style={{ width: `${(total / maxTotal) * 100}%` }}>
                    <span className="amr-train-bar block h-full bg-experimental" style={{ width: `${(p.actives / total) * 100}%` }} />
                    <span
                      className="amr-train-bar block h-full border border-experimental bg-raised"
                      style={{ width: `${(p.inactives / total) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="block h-[3px] bg-accent" style={{ width: `${Math.max(share, 0.6)}%`, opacity: share ? 1 : 0.35 }} />
                    <span className="font-mono text-[11px] tabular-nums text-accent">
                      {share.toFixed(1)}% resistant strain
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-5 text-[13px] leading-relaxed text-ink-2">
            So the models describe each <em>species</em>. They were rarely shown the resistant strain
            itself, and for some species not at all.
          </p>
        </Reveal>

        {/* 3 · The learning step --------------------------------------------- */}
        <Reveal className="amr-train amr-learn rounded-card border border-rule bg-raised p-5 md:p-7">
          <StepHead n="3" title="It learns a pattern, then estimates for medicines it has not seen">
            Labelled structures go in as fingerprints. The model learns which structural features go
            with activity, then scores each approved medicine.
          </StepHead>
          <LearningDiagram threshold={threshold} />
          <p className="m-0 mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
            <span className="mt-1">
              <EvidenceIcon kind="computational" size={11} />
            </span>
            The output is an AI-predicted activity from 0 to 100%. Medicines at {threshold} or more
            are kept for a closer look. That is a discovery filter, not a clinical cutoff.
          </p>
        </Reveal>
      </div>

      {/* For / not for ------------------------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-rule bg-raised p-5 md:p-6">
          <p className="m-0 font-display text-[16px] font-semibold text-ink">What the models are for</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-[14px] leading-snug text-ink-2">
            <li className="flex gap-2.5"><Tick />Sorting the approved-medicine library into a short list worth testing in the laboratory.</li>
            <li className="flex gap-2.5"><Tick />Comparing medicines against one of the four species the models cover.</li>
            <li className="flex gap-2.5"><Tick />Pointing at structures that resemble molecules already measured as active.</li>
          </ul>
        </div>
        <div className="rounded-card border border-rule bg-raised p-5 md:p-6">
          <p className="m-0 font-display text-[16px] font-semibold text-ink">What they cannot tell you</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 text-[14px] leading-snug text-ink-2">
            <li className="flex gap-2.5"><Cross />Whether a medicine treats an infection in a patient.</li>
            <li className="flex gap-2.5"><Cross />Whether it works against the resistant strain specifically.</li>
            <li className="flex gap-2.5"><Cross />What dose would be needed, or whether that dose is safe.</li>
            <li className="flex gap-2.5"><Cross />Anything about pathogens other than these four.</li>
          </ul>
        </div>
      </div>

    </div>
  );
}

function StepHead({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent font-mono text-[13px] text-accent">
        {n}
      </span>
      <div>
        <h3 className="m-0 font-display text-[18px] font-semibold leading-snug text-ink">{title}</h3>
        <p className="m-0 mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </div>
  );
}

function Zone({
  tone,
  title,
  rule,
  count,
}: {
  tone: "active" | "ambiguous" | "inactive";
  title: string;
  rule: string;
  count: string;
}) {
  const bg =
    tone === "active"
      ? "bg-[color-mix(in_oklab,var(--color-experimental)_14%,var(--color-raised))]"
      : tone === "ambiguous"
        ? "amr-hatch"
        : "bg-raised";
  return (
    <div className={`amr-zone flex flex-col gap-1.5 px-3 py-4 md:px-5 ${bg}`} data-tone={tone}>
      <span className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
        {tone === "active" ? <span className="h-2.5 w-2.5 bg-experimental" /> : null}
        {tone === "inactive" ? <span className="h-2.5 w-2.5 border border-experimental" /> : null}
        {tone === "ambiguous" ? <EvidenceIcon kind="unchecked" size={11} /> : null}
        {title}
      </span>
      <span className="font-mono text-[clamp(18px,2vw,24px)] tabular-nums leading-none text-ink">{count}</span>
      <span className="text-[12px] leading-snug text-ink-2">{rule}</span>
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="mt-0.5 shrink-0">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="var(--color-clinical)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="mt-0.5 shrink-0">
      <path d="M4 4 12 12M12 4 4 12" fill="none" stroke="var(--color-accent)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* The learning diagram                                                 */
/* ------------------------------------------------------------------ */

/** Made-up bit patterns: pictures of fingerprints, not real ones. */
const PRINTS: { bits: number[]; active: boolean }[] = [
  { bits: [1, 0, 1, 1, 0, 1, 0, 0, 1], active: true },
  { bits: [0, 1, 0, 0, 1, 0, 1, 1, 0], active: false },
  { bits: [1, 0, 1, 0, 0, 1, 0, 1, 1], active: true },
];
/** The features the active examples share, which the pattern lights. */
const PATTERN = [1, 0, 1, 0, 0, 1, 0, 0, 1];
const NEW = [1, 0, 1, 1, 0, 1, 1, 0, 0];

function Grid({ x, y, bits, cls = "", on = "var(--color-ink)", hot }: { x: number; y: number; bits: number[]; cls?: string; on?: string; hot?: number[] }) {
  return (
    <g className={cls}>
      {bits.map((b, i) => (
        <rect
          key={i}
          className={hot && hot[i] ? "amr-hot" : undefined}
          style={{ ["--k" as string]: i }}
          x={x + (i % 3) * 11}
          y={y + Math.floor(i / 3) * 11}
          width="9"
          height="9"
          fill={b ? on : "none"}
          stroke={b ? "none" : "var(--color-rule-strong)"}
          strokeWidth="1"
        />
      ))}
    </g>
  );
}

function LearningDiagram({ threshold }: { threshold: string }) {
  const T = "var(--color-experimental)";
  return (
    <svg viewBox="0 0 440 190" className="mt-5 block h-auto w-full" aria-hidden="true">
      {/* Inputs: labelled fingerprints. */}
      {PRINTS.map((p, i) => (
        <g key={i} className="amr-in" style={{ ["--i" as string]: i }}>
          <Grid x={8} y={14 + i * 56} bits={p.bits} />
          {p.active ? (
            <rect x={48} y={26 + i * 56} width="9" height="9" fill={T} />
          ) : (
            <rect x={48} y={26 + i * 56} width="9" height="9" fill="none" stroke={T} strokeWidth="1.25" />
          )}
          <path d={`M64 ${30 + i * 56} C96 ${30 + i * 56} 100 92 128 92`} fill="none" stroke="var(--color-rule-strong)" strokeWidth="1.2" />
        </g>
      ))}
      <text x="8" y="186" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-muted)">labelled examples</text>

      {/* The learned pattern. */}
      <rect x="130" y="64" width="62" height="58" rx="3" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="1.4" />
      <Grid x={145} y={77} bits={PATTERN} cls="amr-pattern" on="var(--color-computational)" hot={PATTERN} />
      <text x="161" y="140" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-muted)">pattern</text>
      <path d="M194 93 H228 M222 88 L228 93 L222 98" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />

      {/* A new approved medicine, as a capsule and its fingerprint. */}
      <g className="amr-new">
        <rect x="234" y="56" width="36" height="16" rx="8" fill="none" stroke="var(--color-ink)" strokeWidth="1.4" />
        <path d="M252 56 h10 a8 8 0 0 1 0 16 H252 Z" fill="#f5e6d8" />
        <rect x="234" y="56" width="36" height="16" rx="8" fill="none" stroke="var(--color-ink)" strokeWidth="1.4" />
        <path d="M252 56 V72" stroke="var(--color-ink)" strokeWidth="1.4" />
        <Grid x={236} y={82} bits={NEW} />
        <text x="252" y="140" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-muted)">new medicine</text>
      </g>
      <path d="M282 93 H312 M306 88 L312 93 L306 98" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />

      {/* The estimate on a 0 to 100% scale, against the discovery filter. */}
      <g>
        <path d="M320 110 H432" stroke="var(--color-ink)" strokeWidth="1.5" />
        {[0, 1, 2, 3, 4].map((k) => (
          <path key={k} d={`M${320 + k * 28} 110 v5`} stroke="var(--color-ink)" strokeWidth="1.2" />
        ))}
        <text x="320" y="128" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--color-muted)">0</text>
        <text x="432" y="128" textAnchor="end" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--color-muted)">100%</text>
        <path d="M364.8 70 V116" stroke="var(--color-accent)" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="364.8" y="64" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--color-accent)">{threshold}</text>
        <g className="amr-estimate">
          <path d="M404 84 L412 98 H396 Z" fill="none" stroke="var(--color-computational)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M404 98 V110" stroke="var(--color-computational)" strokeWidth="1.2" />
        </g>
        <text x="376" y="146" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-muted)">AI-predicted activity</text>
      </g>
    </svg>
  );
}
