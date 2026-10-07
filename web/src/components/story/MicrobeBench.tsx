"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { EvidenceIcon } from "@/components/investigate/icons";
import { ORGANISMS } from "@/lib/content";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";
import { OrganismCell } from "./diagrams";

export interface OrganismData {
  key: PathogenKey;
  label: string;
  candidates: number;
  withActivity: number;
  target: { name: string; pdbId: string | null } | null;
}

/**
 * The four pathogens as a small interactive bench.
 *
 * Slide 5 of the presentation shows each species as a cross-section with its
 * resistance feature marked in ochre. Here the reader picks a species, sees its
 * cross-section large with the feature annotated, and watches one schematic
 * drug molecule meet that feature: bound poorly by an altered target, kept out
 * and pumped out, destroyed by an enzyme, held in a waxy envelope. These are
 * exactly the four mechanisms the slide names, and nothing more; the drawing
 * is schematic and not to scale.
 */
export function MicrobeBench({ items, threshold }: { items: OrganismData[]; threshold: string }) {
  const [active, setActive] = useState<PathogenKey>("mrsa");
  const [run, setRun] = useState(0);
  const [hot, setHot] = useState<number | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const it = items.find((i) => i.key === active) ?? items[0];
  const o = ORGANISMS[it.key];
  const notes = ANNOTATIONS[it.key];

  const select = (key: PathogenKey) => {
    setActive(key);
    setHot(null);
    setRun((r) => r + 1);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = PATHOGEN_KEYS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last ? 0 : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0 ? last : index - 1
          : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    select(items[next].key);
    tabs.current[next]?.focus();
  };

  return (
    <div className="amr-bench">
      {/* The comparison row: all four at once, as on the slide. */}
      <div
        role="tablist"
        aria-label="Pathogen coverage: the four pathogen species"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-rule bg-rule lg:grid-cols-4"
      >
        {items.map((p, i) => {
          const on = p.key === active;
          return (
            <button
              key={p.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${p.key}`}
              aria-selected={on}
              aria-controls={`${base}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(p.key)}
              onKeyDown={(e) => onKey(e, i)}
              className="amr-bench-tab flex items-center gap-4 bg-raised px-4 py-4 text-left md:px-5"
            >
              <OrganismCell pathogen={p.key} size={52} />
              <span className="min-w-0">
                <span
                  className={`block font-display text-[18px] font-semibold leading-tight text-ink ${
                    p.key === "mrsa" ? "" : "italic"
                  }`}
                >
                  {p.label}
                </span>
                <span className="mt-1 block font-mono text-[11px] text-muted">
                  {ORGANISMS[p.key].classification}
                </span>
                <span className="mt-0.5 hidden text-[12px] leading-snug text-ink-2 sm:block">
                  {ORGANISMS[p.key].resistance}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${it.key}`}
        className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
      >
        {/* The stage. */}
        <figure className="m-0 flex flex-col rounded-card border border-rule bg-raised">
          <div className="relative flex flex-1 items-center justify-center px-4 pb-2 pt-6">
            <BenchDiagram key={`${it.key}-${run}`} pathogen={it.key} hot={hot} />
          </div>
          <figcaption className="flex flex-wrap items-center justify-between gap-3 border-t border-rule-soft px-4 py-3">
            <span className="flex items-center gap-2 text-[12px] text-muted">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
              {it.key === "mrsa" ? "Beta-lactam antimicrobial" : it.key === "kpneumoniae" ? "Carbapenem antimicrobial" : "Drug molecule"}
              , schematic, not to scale
            </span>
            <button type="button" onClick={() => setRun((r) => r + 1)} className="amr-btn-quiet !min-h-9 !px-3 !text-[12px]">
              Replay <span data-arrow aria-hidden="true">↻</span>
            </button>
          </figcaption>
        </figure>

        {/* What the slide says, and what the project holds. */}
        <div className="flex flex-col rounded-card border border-rule bg-raised p-5 md:p-6">
          <p
            className={`m-0 font-display text-[24px] font-semibold leading-none tracking-[-0.02em] text-ink ${
              it.key === "mrsa" ? "" : "italic"
            }`}
          >
            {it.label}
          </p>
          <p className="m-0 mt-2 text-[15px] italic text-ink-2">
            {o.scientific} <span className="not-italic text-faint">·</span>{" "}
            <span className="font-mono text-[12px] not-italic text-muted">{o.classification}</span>
          </p>

          <p className="m-0 mt-5 font-mono text-[12px] text-accent">{o.resistanceLabel}</p>
          <p className="m-0 mt-1 font-display text-[17px] font-semibold leading-snug text-ink">{o.resistance}</p>
          <p className="m-0 mt-2 text-[14px] leading-relaxed text-ink-2">{o.detail}</p>

          <ol className="m-0 mt-5 flex list-none flex-col gap-1 border-t border-rule-soft p-0 pt-4">
            {notes.map((note, i) => (
              <li key={note.text}>
                <button
                  type="button"
                  onMouseEnter={() => setHot(i)}
                  onMouseLeave={() => setHot(null)}
                  onFocus={() => setHot(i)}
                  onBlur={() => setHot(null)}
                  className="amr-note flex w-full items-start gap-3 rounded-card px-2 py-1.5 text-left text-[14px] leading-snug text-ink"
                  data-hot={hot === i ? "" : undefined}
                >
                  <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent font-mono text-[11px] text-accent">
                    {i + 1}
                  </span>
                  {note.text}
                </button>
              </li>
            ))}
          </ol>

          <dl className="m-0 mt-auto grid gap-3 border-t border-rule-soft pt-4 [margin-top:1.25rem] sm:grid-cols-2">
            <div>
              <dt className="flex items-center gap-1.5 font-mono text-[11px] text-computational">
                <EvidenceIcon kind="computational" size={10} />
                Repurposing candidates {threshold}
              </dt>
              <dd className="m-0 mt-1 font-mono text-[22px] tabular-nums leading-none text-ink">
                {it.candidates.toLocaleString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 font-mono text-[11px] text-computational">
                <EvidenceIcon kind="computational" size={10} />
                Docking target used
              </dt>
              <dd className="m-0 mt-1 text-[13px] leading-snug text-ink-2">
                {it.target
                  ? `${it.target.name}${it.target.pdbId ? ` (PDB ${it.target.pdbId})` : ""}`
                  : "Not yet checked"}
              </dd>
            </div>
          </dl>
          <Link
            href={`/investigate?pathogen=${it.key}`}
            className="mt-4 self-start font-display text-[13px] font-semibold"
          >
            See all {it.candidates.toLocaleString("en-GB")} candidates for {it.label} →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The large annotated cross-sections                                  */
/* ------------------------------------------------------------------ */

interface Note {
  text: string;
  /** Marker position in the 400 × 300 drawing. */
  x: number;
  y: number;
}

/** Each note restates the slide's own wording for that species. */
const ANNOTATIONS: Record<PathogenKey, Note[]> = {
  mrsa: [
    { text: "Thick cell wall of a Gram-positive pathogen", x: 268, y: 92 },
    { text: "PBP2a, the altered target", x: 256, y: 128 },
    { text: "The beta-lactam binds the altered target poorly and does not hold", x: 92, y: 80 },
  ],
  ecoli: [
    { text: "Protective outer membrane limits what gets in", x: 132, y: 72 },
    { text: "Efflux pump spanning the envelope", x: 300, y: 128 },
    { text: "A drug that does enter is pushed back out", x: 352, y: 168 },
  ],
  kpneumoniae: [
    { text: "Outer membrane of a Gram-negative pathogen", x: 276, y: 88 },
    { text: "Carbapenemase enzymes in the envelope", x: 190, y: 40 },
    { text: "The carbapenem is destroyed before it reaches the cell", x: 64, y: 176 },
  ],
  mtb: [
    { text: "Waxy envelope rich in mycolic acids (acid-fast)", x: 284, y: 84 },
    { text: "Many drugs are held in the envelope and do not reach the cell", x: 92, y: 190 },
  ],
};

const INK = "var(--color-ink)";
const RULE = "var(--color-rule-strong)";
const OCHRE = "var(--color-accent)";
const C = { x: 200, y: 150 };

function BenchDiagram({ pathogen, hot }: { pathogen: PathogenKey; hot: number | null }) {
  const notes = ANNOTATIONS[pathogen];
  const reduce = useReducedMotion();
  return (
    <svg
      viewBox="0 0 400 300"
      className={`amr-bench-svg h-auto w-full max-w-[520px] amr-play-${pathogen}`}
      role="img"
      aria-label={`${ORGANISMS[pathogen].scientific}: ${ORGANISMS[pathogen].resistance}. Schematic.`}
    >
      {pathogen === "mrsa" ? (
        <>
          <circle cx={C.x} cy={C.y} r="100" fill="var(--color-sunken)" stroke={INK} strokeWidth="1.5" />
          <circle cx={C.x} cy={C.y} r="78" fill="var(--color-raised)" stroke={INK} strokeWidth="1.5" />
          {/* Wall texture: short radial strokes through the thick wall. */}
          {Array.from({ length: 36 }, (_, i) => {
            const t = (i / 36) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={r2(C.x + 81 * Math.cos(t))}
                y1={r2(C.y + 81 * Math.sin(t))}
                x2={r2(C.x + 97 * Math.cos(t))}
                y2={r2(C.y + 97 * Math.sin(t))}
                stroke={RULE}
                strokeWidth="1"
              />
            );
          })}
          {/* PBP2a: drawn with a notch, so the drug's round shape cannot seat. */}
          <path
            className="amr-feature"
            d="M216 92 h26 v22 h-26 v-7 h7 v-8 h-7 Z"
            fill={OCHRE}
          />
        </>
      ) : null}

      {pathogen === "ecoli" || pathogen === "kpneumoniae" ? (
        <>
          <circle cx={C.x} cy={C.y} r="100" fill="var(--color-raised)" stroke={INK} strokeWidth="1.75" />
          <circle cx={C.x} cy={C.y} r="92" fill="#f8f5ee" stroke={RULE} strokeWidth="1.2" strokeDasharray="2 3" />
          <circle cx={C.x} cy={C.y} r="84" fill="var(--color-raised)" stroke={INK} strokeWidth="1.5" />
        </>
      ) : null}

      {pathogen === "ecoli" ? (
        <g className="amr-feature">
          {/* An efflux pump spanning both membranes. */}
          <rect x="276" y="138" width="34" height="24" fill={OCHRE} />
          <path d="M282 150 h20 M296 144 l6 6 l-6 6" stroke="var(--color-raised)" strokeWidth="2" fill="none" />
        </g>
      ) : null}

      {pathogen === "kpneumoniae"
        ? [158, 250, 300, 30, 100].map((deg) => {
            const t = (deg * Math.PI) / 180;
            return (
              <g key={deg} className="amr-feature">
                <circle cx={r2(C.x + 92 * Math.cos(t))} cy={r2(C.y + 92 * Math.sin(t))} r="7" fill={OCHRE} />
                <path
                  d={`M${r2(C.x + 92 * Math.cos(t) - 3)} ${r2(C.y + 92 * Math.sin(t))} h6`}
                  stroke="var(--color-raised)"
                  strokeWidth="1.5"
                />
              </g>
            );
          })
        : null}

      {pathogen === "mtb" ? (
        <>
          <circle className="amr-feature" cx={C.x} cy={C.y} r="108" fill="var(--color-sunken)" stroke={OCHRE} strokeWidth="1.5" strokeDasharray="5 4" />
          {/* Wax: short wavy strokes packed through the thick envelope. */}
          {Array.from({ length: 30 }, (_, i) => {
            const t = (i / 30) * Math.PI * 2;
            const inner = 76;
            const outer = 102;
            const mx = C.x + ((inner + outer) / 2) * Math.cos(t + 0.06);
            const my = C.y + ((inner + outer) / 2) * Math.sin(t + 0.06);
            return (
              <path
                key={i}
                d={`M${r2(C.x + inner * Math.cos(t))} ${r2(C.y + inner * Math.sin(t))} Q${r2(mx)} ${r2(my)} ${r2(C.x + outer * Math.cos(t))} ${r2(C.y + outer * Math.sin(t))}`}
                stroke={OCHRE}
                strokeOpacity="0.35"
                strokeWidth="1.2"
                fill="none"
              />
            );
          })}
          <circle cx={C.x} cy={C.y} r="70" fill="var(--color-raised)" stroke={INK} strokeWidth="1.5" />
        </>
      ) : null}

      {/* The drug's path, drawn faintly so the motion is legible when still. */}
      <path d={DRUG_PATH[pathogen]} fill="none" stroke={OCHRE} strokeOpacity="0.35" strokeWidth="1.25" strokeDasharray="3 4" />
      <Drug path={DRUG_PATH[pathogen]} {...TIMING[pathogen]} reduce={reduce} />
      {pathogen === "ecoli" ? <Drug path={BLOCKED_PATH} dur={2.2} begin={0.2} reduce={reduce} /> : null}

      {/* Numbered markers, matched to the list beside the drawing. */}
      {notes.map((n, i) => (
        <g key={n.text} className="amr-marker" data-hot={hot === i ? "" : undefined}>
          <circle cx={n.x} cy={n.y} r="11" fill="var(--color-raised)" stroke={OCHRE} strokeWidth="1.25" />
          <text
            x={n.x}
            y={n.y + 4}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="12"
            fill={OCHRE}
          >
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Where each species' drug molecule travels (CSS offset-path). */
const DRUG_PATH: Record<PathogenKey, string> = {
  // Comes in to the altered target, fails to seat, drifts away.
  mrsa: "M40 40 C110 50 160 80 206 103 C190 96 150 70 120 50",
  // Enters, crosses to the pump, and is pushed out the other side.
  ecoli: "M200 16 C200 60 205 100 220 130 C240 150 262 150 290 150 L388 150",
  // Enters the envelope and meets an enzyme, where it is destroyed.
  kpneumoniae: "M20 210 C60 205 90 190 114 184",
  // Pushes into the thick envelope and stalls inside it.
  mtb: "M14 150 C50 150 80 150 104 150",
};

/** E. coli's second molecule: turned back at the outer membrane. */
const BLOCKED_PATH = "M20 96 C60 96 86 100 106 106 C86 100 60 90 30 80";

/** Duration and end state of each species' molecule. */
const TIMING: Record<PathogenKey, { dur: number; begin?: number; fade?: number; settle?: boolean }> = {
  mrsa: { dur: 2.8 },
  ecoli: { dur: 3.2, begin: 0.5 },
  kpneumoniae: { dur: 1.8, fade: 0 },
  mtb: { dur: 2.4, fade: 0.45, settle: true },
};

/**
 * One schematic drug molecule travelling its path once (SVG animateMotion,
 * restarted by remounting). With reduced motion it is placed at the end of its
 * path at once, so the drawing still says where the drug ends up.
 */
function Drug({
  path,
  dur,
  begin = 0.3,
  fade,
  settle = false,
  reduce,
}: {
  path: string;
  dur: number;
  begin?: number;
  fade?: number;
  settle?: boolean;
  reduce: boolean;
}) {
  const d = reduce ? 0.001 : dur;
  const b = reduce ? 0 : begin;
  return (
    <circle r="7" fill={OCHRE} opacity="0">
      <set attributeName="opacity" to="1" begin={`${b}s`} fill="freeze" />
      <animateMotion
        path={path}
        dur={`${d}s`}
        begin={`${b}s`}
        fill="freeze"
        calcMode="spline"
        keyTimes="0;1"
        keySplines={settle ? "0.1 0.8 0.2 1" : "0.45 0 0.25 1"}
      />
      {fade !== undefined ? (
        <animate
          attributeName="opacity"
          to={String(fade)}
          begin={`${b + d}s`}
          dur={reduce ? "0.001s" : "0.5s"}
          fill="freeze"
        />
      ) : null}
    </circle>
  );
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduce;
}

/** Two decimals: server and browser trig differ in the last digit. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
