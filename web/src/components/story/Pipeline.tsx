import { EvidenceIcon } from "@/components/investigate/icons";
import { PIPELINE } from "@/lib/content";
import { Reveal } from "./Reveal";

/**
 * "How this site works", after slide 6 of the presentation ("From molecule to
 * evidence"), as a process diagram.
 *
 * Six nodes on one line: the five stages the project runs, and the sixth it
 * does not. Each node carries a small drawing of what the stage works on
 * (a medicine and its lab records, a structure becoming a fingerprint, an
 * estimate against the discovery filter, a molecule in a protein pocket, a
 * registry record, a flask), so the sequence reads before the words do.
 *
 * Beneath, aligned to the stages that produce them, is what each step adds:
 * prediction, structural hypothesis, existing evidence. The line is solid as
 * far as the project went and dashed into laboratory testing, which was not
 * performed. A tracer runs the solid line once when the diagram is first seen
 * and stops at the last stage the project ran.
 */
export interface PipelineFigures {
  medicines: number;
  validMolecules: number;
  labelledLabRecords: number;
  libraryPredictions: number;
  withActivity: number;
  threshold: string;
  dockedMedicines: number;
  registryChecked: number;
}

export function Pipeline({ figures }: { figures: PipelineFigures }) {
  const n = (v: number) => v.toLocaleString("en-GB");
  const counts: { value: string; text: string; flag?: string }[] = [
    { value: n(figures.medicines), text: `approved medicines · ${n(figures.labelledLabRecords)} labelled lab records` },
    { value: n(figures.validMolecules), text: "valid molecular structures, each stored as a fingerprint" },
    {
      value: n(figures.libraryPredictions),
      text: `predictions; ${n(figures.withActivity)} medicines reach ${figures.threshold} for at least one bacterium`,
    },
    { value: n(figures.dockedMedicines), text: "medicines docked so far", flag: "subset only" },
    { value: `${n(figures.registryChecked)} / ${n(figures.medicines)}`, text: "medicines checked for registered studies" },
  ];
  return (
    <Reveal className="amr-process">
      <ol className="amr-nodes relative m-0 grid list-none grid-cols-1 gap-0 p-0 lg:-mx-[10px] lg:grid-cols-6">
        <span aria-hidden="true" className="amr-track" />
        <span aria-hidden="true" className="amr-track-dashed" />
        <span aria-hidden="true" className="amr-tracer" />

        {PIPELINE.map((s, i) => (
          <li
            key={s.verb}
            data-stage={i + 1}
            style={{ ["--i" as string]: i, ["--t" as string]: `${500 + i * 580}ms` }}
            className="amr-node"
          >
            <div className="amr-glyph">
              <StageGlyph stage={i + 1} />
            </div>
            <div className="amr-node-text">
              <p className="m-0 font-mono text-[13px] tabular-nums text-accent">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="m-0 mt-1 font-display text-[17px] font-semibold uppercase leading-tight tracking-[0.02em] text-ink">
                {s.verb}
              </h3>
              <p className="m-0 mt-2 text-[14px] leading-snug text-ink">{s.line}</p>
              <p
                className="m-0 mt-2.5 flex items-center gap-1.5 font-mono text-[11px]"
                style={{ color: `var(--color-${s.evidence})` }}
              >
                <EvidenceIcon kind={s.evidence} size={10} />
                {s.evidenceLabel}
              </p>
              <p className="m-0 mt-3 border-t border-rule-soft pt-2.5 text-[12px] leading-snug text-ink-2">
                <span className="mr-1.5 font-mono text-[14px] tabular-nums text-ink">{counts[i].value}</span>
                {counts[i].text}
                {counts[i].flag ? (
                  <span className="ml-1.5 whitespace-nowrap border border-accent px-1.5 py-px font-mono text-[10px] text-accent">
                    {counts[i].flag}
                  </span>
                ) : null}
              </p>
              {YIELDS[i] ? <Yield {...YIELDS[i]!} mobile /> : null}
            </div>
          </li>
        ))}

        <li data-stage={6} style={{ ["--i" as string]: 5 }} className="amr-node amr-node-lab">
          <div className="amr-glyph">
            <StageGlyph stage={6} />
          </div>
          <div className="amr-node-text">
            <p className="m-0 font-mono text-[13px] text-muted">06</p>
            <h3 className="m-0 mt-1 font-display text-[17px] font-semibold uppercase leading-tight tracking-[0.02em] text-ink-2">
              Laboratory testing
            </h3>
            <p className="m-0 mt-2 inline-block border border-dashed border-ink px-2 py-1 font-mono text-[12px] text-ink">
              Not performed in this project
            </p>
            <p className="m-0 mt-2 text-[13px] leading-snug text-ink-2">
              No new patient or laboratory experiments were performed.
            </p>
          </div>
        </li>
      </ol>

      {/* What each stage adds, aligned under the stage that produces it. */}
      <div className="mt-8 hidden grid-cols-6 items-stretch gap-0 lg:-mx-[10px] lg:grid">
        <p className="col-span-2 m-0 self-center pr-6 text-right font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          What each step adds →
        </p>
        {YIELDS.slice(2).map((y) => (y ? <Yield key={y.label} {...y} /> : null))}
        <div className="amr-yield amr-yield-lab mx-2 flex items-center border border-dashed border-ink px-3 py-2.5">
          <span className="text-[14px] leading-tight text-ink-2">
            Laboratory testing
            <span className="mt-0.5 block font-mono text-[11px] text-ink">not performed in this project</span>
          </span>
        </div>
      </div>
    </Reveal>
  );
}

const YIELDS: ({ label: string; kind: "computational" | "clinical"; stage: number } | null)[] = [
  null,
  null,
  { label: "Prediction", kind: "computational", stage: 3 },
  { label: "Structural hypothesis", kind: "computational", stage: 4 },
  { label: "Existing evidence", kind: "clinical", stage: 5 },
];

function Yield({
  label,
  kind,
  stage,
  mobile = false,
}: {
  label: string;
  kind: "computational" | "clinical";
  stage: number;
  mobile?: boolean;
}) {
  return (
    <div
      data-yield={stage}
      className={`amr-yield flex items-center gap-2 border border-rule bg-raised px-3 py-2.5 ${
        mobile ? "mt-3 inline-flex lg:hidden" : "mx-2"
      }`}
    >
      <EvidenceIcon kind={kind} size={11} />
      <span className="text-[14px] leading-tight text-ink">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The six drawings                                                     */
/* ------------------------------------------------------------------ */

const INK = "var(--color-ink)";
const RULE = "var(--color-rule-strong)";
const OCHRE = "var(--color-accent)";
const TEAL = "var(--color-experimental)";
const INDIGO = "var(--color-computational)";
const GREEN = "var(--color-clinical)";

function hex(cx: number, cy: number, r: number): string {
  const w = r * 0.866;
  return `M${cx} ${cy - r}L${cx + w} ${cy - r / 2}L${cx + w} ${cy + r / 2}L${cx} ${cy + r}L${cx - w} ${cy + r / 2}L${cx - w} ${cy - r / 2}Z`;
}

/** A fixed, made-up bit pattern: a picture of a fingerprint, not a real one. */
const BITS = [1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];

export function StageGlyph({ stage }: { stage: number }) {
  return (
    <svg viewBox="8 6 82 62" className="block h-[58px] w-auto max-w-full lg:h-[66px]" aria-hidden="true">
      {stage === 1 ? (
        <>
          {/* A medicine, and the laboratory records gathered with it. */}
          <g transform="rotate(-24 34 38)">
            <rect x="12" y="29" width="44" height="18" rx="9" fill="none" stroke={INK} strokeWidth="1.75" />
            <path d="M34 29 h13 a9 9 0 0 1 0 18 H34 Z" fill="#f5e6d8" stroke="none" />
            <rect x="12" y="29" width="44" height="18" rx="9" fill="none" stroke={INK} strokeWidth="1.75" />
            <path d="M34 29 V47" stroke={INK} strokeWidth="1.75" />
          </g>
          {[22, 34, 46].map((y, k) => (
            <g key={y} className="amr-g-pop" style={{ ["--k" as string]: k }}>
              <rect x="64" y={y - 3} width="6" height="6" fill={TEAL} />
              <path d={`M74 ${y} H88`} stroke={RULE} strokeWidth="2" />
            </g>
          ))}
        </>
      ) : null}
      {stage === 2 ? (
        <>
          {/* A structure, turned into a pattern the computer can compare. */}
          <path d={hex(22, 36, 13)} fill="none" stroke={INK} strokeWidth="1.75" />
          <path d="M33.3 29.5 L42 24" stroke={INK} strokeWidth="1.75" />
          <circle cx="43" cy="23.5" r="3" fill={OCHRE} />
          <path d="M44 42 h8 M49 38.5 l3.5 3.5 l-3.5 3.5" fill="none" stroke={OCHRE} strokeWidth="1.5" />
          {BITS.map((b, i) => (
            <rect
              key={i}
              className={b ? "amr-g-bit" : undefined}
              style={b ? { ["--k" as string]: i } : undefined}
              x={58 + (i % 4) * 8}
              y={20 + Math.floor(i / 4) * 8}
              width="6.5"
              height="6.5"
              fill={b ? INK : "none"}
              stroke={b ? "none" : RULE}
              strokeWidth="1"
            />
          ))}
        </>
      ) : null}
      {stage === 3 ? (
        <>
          {/* An estimate placed on a 0 to 100% scale, against the 40% filter. */}
          <path d="M12 50 H84" stroke={INK} strokeWidth="1.75" />
          {[12, 30, 48, 66, 84].map((x) => (
            <path key={x} d={`M${x} 50 v5`} stroke={INK} strokeWidth="1.25" />
          ))}
          <path d="M40.8 18 V56" stroke={OCHRE} strokeWidth="1.25" strokeDasharray="3 3" />
          <g className="amr-g-slide">
            <path d="M64 30 L71 42 H57 Z" fill="none" stroke={INDIGO} strokeWidth="1.75" strokeLinejoin="round" />
            <path d="M64 42 V50" stroke={INDIGO} strokeWidth="1.25" />
          </g>
          <text x="40.8" y="14" textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill={OCHRE}>
            40%
          </text>
        </>
      ) : null}
      {stage === 4 ? (
        <>
          {/* A molecule fitted into a protein's binding site. */}
          <path
            d="M18 62 V38 a30 25 0 0 1 60 0 V62 H62 V47 a14 11 0 0 0 -28 0 V62 Z"
            fill="#e4e2f6"
            stroke={INDIGO}
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path className="amr-dock" d={hex(48, 51, 9)} fill="var(--color-raised)" stroke={INK} strokeWidth="1.75" />
        </>
      ) : null}
      {stage === 5 ? (
        <>
          {/* A registered study record: what has already been studied. */}
          <path d="M28 10 H60 L70 20 V64 H28 Z" fill="var(--color-raised)" stroke={INK} strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M60 10 V20 H70" fill="none" stroke={INK} strokeWidth="1.5" />
          <path className="amr-g-pop" style={{ ["--k" as string]: 4 }} d="M42 22 l5 5 l-5 5 l-5 -5 Z" fill={GREEN} />
          {[38, 46, 54].map((y, k) => (
            <path
              key={y}
              className="amr-g-grow"
              style={{ ["--k" as string]: k }}
              d={`M36 ${y} H${y === 54 ? 52 : 62}`}
              stroke={RULE}
              strokeWidth="2"
            />
          ))}
        </>
      ) : null}
      {stage === 6 ? (
        <>
          {/* A flask, in outline only: this step was not taken. */}
          <path
            d="M41 10 H55 M43 10 V30 L26 60 a3 3 0 0 0 3 4 H67 a3 3 0 0 0 3 -4 L53 30 V10"
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth="1.75"
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  );
}
