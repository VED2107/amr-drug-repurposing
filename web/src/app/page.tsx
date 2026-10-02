import Link from "next/link";

import { EvidenceIcon } from "@/components/investigate";
import { Page } from "@/components/primitives";
import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { BacteriaBench } from "@/components/story/BacteriaBench";
import { Pipeline } from "@/components/story/Pipeline";
import { HeroChain } from "@/components/story/HeroChain";
import { MethodLink } from "@/components/story/MethodLink";
import { OrganismCell } from "@/components/story/diagrams";
import { REPURPOSING_EXAMPLES } from "@/lib/content";
import { getRepurposingSummary } from "@/lib/queries/repurposing";
import { getStoryFigures } from "@/lib/queries/story";
import { DISCOVERY_THRESHOLD_TEXT } from "@/lib/science";

export const dynamic = "force-dynamic";

/**
 * The overview: what this project is, in the words a pharmacy student uses,
 * and how to read what the dashboard shows. Every count is read live.
 */
export default async function Overview() {
  const [summary, figures] = await Promise.all([getRepurposingSummary(), getStoryFigures()]);

  return (
    <Page>
      {/* --- Opening ---------------------------------------------------- */}
      <section className="grid gap-10 pt-2 md:pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-16">
        <div className="lg:pt-10">
          <h1 className="m-0 max-w-[16ch] text-balance font-display text-[clamp(38px,6.4vw,84px)] font-semibold leading-[0.98] tracking-[-0.035em] text-ink">
            Old medicines, new questions.
          </h1>
          <p className="m-0 mt-6 max-w-[58ch] text-[17px] leading-relaxed text-ink-2">
            Bacteria are becoming resistant to the antibiotics we rely on, and new antibiotics
            take many years to develop. This project asks a faster question: could a medicine that
            is <strong className="font-semibold text-ink">already approved</strong> for something
            else also act against a drug-resistant bacterium?
          </p>
          <div className="mt-7 border-y border-rule py-4">
            <HeroChain />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="amr-btn">
              Open the dashboard <span data-arrow aria-hidden="true">→</span>
            </Link>
            <Link href="/investigate?condition=Tuberculosis" className="amr-btn-quiet">
              <OrganismCell pathogen="mtb" size={20} />
              Try an example: tuberculosis
            </Link>
          </div>
        </div>

        <PopulationPanel
          molecules={figures.validMolecules}
          medicines={summary.medicines}
          candidates={summary.candidates}
          studies={summary.registeredStudies}
        />
      </section>

      {/* --- Repurposing -------------------------------------------------- */}
      <Chapter
        title="What is drug repurposing?"
        lede="Finding a new use for a medicine that is already approved. Its safety in people is already known, so testing a new use can be faster and cheaper than starting from nothing."
      >
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
          {REPURPOSING_EXAMPLES.map((e) => (
            <li key={e.name} className="amr-repurpose rounded-card border border-rule bg-raised p-5 md:p-6">
              <p className="m-0 flex items-center gap-2.5 font-display text-[18px] font-semibold text-ink">
                <svg viewBox="0 0 30 14" width="30" height="14" aria-hidden="true" className="shrink-0">
                  <path d="M15 1 h7 a6 6 0 0 1 0 12 H15 Z" fill="#f5e6d8" />
                  <rect x="1" y="1" width="28" height="12" rx="6" fill="none" stroke="var(--color-ink)" strokeWidth="1.4" />
                  <path d="M15 1 V13" stroke="var(--color-ink)" strokeWidth="1.4" />
                </svg>
                {e.name}
              </p>
              {/* A short track from the first use to the later one. */}
              <div className="amr-track-v relative mt-4 grid grid-cols-[14px_minmax(0,1fr)] gap-x-3">
                <span aria-hidden="true" className="mt-[5px] h-[9px] w-[9px] rounded-full border border-ink-2 bg-raised" />
                <p className="m-0">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">First used for</span>
                  <span className="mt-1 block text-[14px] leading-snug text-ink-2">{e.from}</span>
                </p>
                <span aria-hidden="true" className="amr-track-v-node mt-4 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-accent text-[9px] leading-none text-paper">
                  ↓
                </span>
                <p className="m-0 mt-3.5">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-accent">Later also used for</span>
                  <span className="mt-1 block text-[14px] leading-snug text-ink">{e.to}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Chapter>

      {/* --- How it works ------------------------------------------------ */}
      <Chapter
        id="how-it-works"
        title="How this site works"
        lede="From molecule to evidence: five steps the project ran, and the one it did not."
      >
        <Pipeline
          figures={{
            medicines: summary.medicines,
            validMolecules: figures.validMolecules,
            labelledLabRecords: figures.labelledLabRecords,
            libraryPredictions: figures.libraryPredictions,
            withActivity: summary.withActivity,
            threshold: DISCOVERY_THRESHOLD_TEXT,
            dockedMedicines: figures.dockedMedicines,
            registryChecked: figures.registryChecked,
          }}
        />
      </Chapter>

      {/* --- Bacteria ------------------------------------------------------ */}
      <section id="how-the-models-learned" aria-label="The full method" className="mt-14">
        <MethodLink />
      </section>

      <Chapter
        id="bacteria"
        title="Four bacteria. Four different resistance problems."
        lede="Only these four can show a percentage. Any other condition shows documented evidence only."
      >
        <BacteriaBench
          threshold={DISCOVERY_THRESHOLD_TEXT}
          items={summary.pathogens.map((p) => ({
            key: p.key,
            label: p.label,
            candidates: p.candidates,
            withActivity: p.withActivity,
            target: figures.targets.find((t) => t.pathogenKey === p.key) ?? null,
          }))}
        />
        <p className="m-0 mt-4 flex max-w-[80ch] items-start gap-2.5 text-[14px] leading-relaxed text-ink-2">
          <span className="mt-1">
            <EvidenceIcon kind="computational" size={12} />
          </span>
          <span>
            The models in this project provide AI-predicted activity only for these four species. They
            are not predictions for every bacterial species or every resistant strain: the models learn
            patterns from previous laboratory measurements, and they do not directly simulate a
            patient&rsquo;s response. Diagrams are schematic, not to scale.
          </span>
        </p>
      </Chapter>

      {/* --- Start ---------------------------------------------------------- */}
      <section className="mt-20 rounded-card border border-rule bg-raised p-6 md:p-10">
        <h2 className="m-0 font-display text-[clamp(24px,3vw,36px)] font-semibold tracking-[-0.02em] text-ink">
          Start investigating
        </h2>
        <p className="m-0 mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          Search a condition to see the medicines already documented for it and the other medicines
          the model surfaces, or search a medicine to see all four of its predictions.
        </p>
        <div className="mt-6 max-w-[760px]">
          <InvestigateSearch />
        </div>
      </section>
    </Page>
  );
}

/**
 * The opening figures, as two populations that are never summed.
 *
 * A unit chart: one dot for about a hundred. The broader molecular dataset is
 * a dense field; the approved-medicine library that is actually screened is a
 * small, separate cluster below a "different population" rule, with its
 * repurposing candidates marked in indigo. Registered studies count studies,
 * not medicines, so they are listed beside the chart rather than drawn in it.
 */
function PopulationPanel({
  molecules,
  medicines,
  candidates,
  studies,
}: {
  molecules: number;
  medicines: number;
  candidates: number;
  studies: number;
}) {
  const n = (v: number) => v.toLocaleString("en-GB");
  const UNIT = 100;
  const pills = Math.round(medicines / UNIT);
  const marked = Math.round(candidates / UNIT);
  return (
    <div className="amr-pop flex flex-col gap-3">
      {/* Sheet one: the broader molecular dataset. */}
      <div className="amr-key-molecules grid items-center gap-x-6 gap-y-4 rounded-card border border-rule bg-raised px-6 py-5 sm:grid-cols-[auto_minmax(0,1fr)] md:px-7">
        <div>
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Broader molecular dataset</p>
          <p className="m-0 mt-3 font-mono text-[clamp(56px,6vw,84px)] font-medium leading-[0.85] tracking-[-0.04em] text-ink">
            {`${Math.floor(molecules / 1000)}K`}
          </p>
          <p className="m-0 mt-3 max-w-[22ch] text-[14px] leading-snug text-ink-2">
            molecular structures the research pipeline learns from{" "}
            <span className="whitespace-nowrap font-mono text-[12px] text-muted">({n(molecules)})</span>
          </p>
        </div>
        <UnitField count={Math.round(molecules / UNIT)} shape="hex" />
      </div>

      {/* Sheet two: the approved-medicine library, the population screened. */}
      <div className="rounded-card border border-rule bg-raised px-6 pb-5 pt-5 md:px-7">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Approved-medicine library</p>
        <p className="amr-key-library m-0 mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[clamp(34px,3.6vw,46px)] font-medium tabular-nums leading-none tracking-[-0.02em] text-ink">
            {n(medicines)}
          </span>
          <span className="text-[15px] text-ink">approved medicines checked</span>
        </p>

        <div className="mt-4 max-w-[400px]">
          <UnitField count={pills} marked={marked} shape="pill" />
          {/* The bracket: under the indigo capsules, naming what they are. */}
          <div className="amr-key-candidates relative mt-1.5" style={{ width: `${(marked / pills) * 100}%` }}>
            <span aria-hidden="true" className="amr-bracket block h-2 border-x border-b border-computational" />
            <p className="m-0 mt-2 font-mono text-[26px] font-medium tabular-nums leading-none text-computational">
              {n(candidates)}
            </p>
          </div>
          <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink-2">
            repurposing candidates: not already antibacterials, with AI-predicted activity{" "}
            {DISCOVERY_THRESHOLD_TEXT} against at least one bacterium
          </p>
        </div>

        <p className="m-0 mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule-soft pt-4">
          <span className="self-center">
            <EvidenceIcon kind="clinical" size={10} />
          </span>
          <span className="font-mono text-[22px] font-medium tabular-nums leading-none text-ink">{n(studies)}</span>
          <span className="text-[13px] text-ink-2">registered clinical studies linked to them</span>
        </p>
        <p className="m-0 mt-4 font-mono text-[10.5px] leading-relaxed text-faint">
          One hexagon ≈ {UNIT} molecular structures. One capsule ≈ {UNIT} medicines. Rounded.
        </p>
      </div>
    </div>
  );
}

/**
 * A field of units, one per ~100. Molecules are drawn as small hexagons in a
 * honeycomb, medicines as small capsules; the first `marked` capsules are the
 * repurposing candidates, in indigo.
 */
function UnitField({
  count,
  shape,
  marked = 0,
  className = "",
}: {
  count: number;
  shape: "hex" | "pill";
  marked?: number;
  className?: string;
}) {
  const COLS = shape === "hex" ? 17 : count;
  const SX = shape === "hex" ? 11.5 : 20;
  const SY = shape === "hex" ? 10 : 12;
  const rows = Math.ceil(count / COLS);
  const width = COLS * SX + (shape === "hex" ? SX / 2 : 0);
  return (
    <svg
      viewBox={`0 0 ${width} ${rows * SY + 2}`}
      className={`amr-units amr-units-${shape} block h-auto ${shape === "hex" ? "w-full" : "w-full max-w-[400px]"} ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => {
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const style = { ["--r" as string]: r, ["--c" as string]: c };
        if (shape === "hex") {
          const cx = c * SX + SX / 2 + (r % 2 ? SX / 2 : 0);
          const cy = r * SY + SY / 2 + 1;
          const R = 4.2;
          const w = R * 0.866;
          return (
            <path
              key={i}
              className="amr-unit"
              style={style}
              d={`M${cx} ${cy - R}L${cx + w} ${cy - R / 2}L${cx + w} ${cy + R / 2}L${cx} ${cy + R}L${cx - w} ${cy + R / 2}L${cx - w} ${cy - R / 2}Z`}
              fill="none"
              stroke="var(--color-rule-strong)"
              strokeWidth="1.1"
            />
          );
        }
        const x = c * SX + 2;
        const y = r * SY + 2;
        const on = i < marked;
        return (
          <g key={i} className={`amr-unit ${on ? "is-marked" : ""}`} style={style}>
            <rect
              x={x}
              y={y}
              width="15"
              height="7"
              rx="3.5"
              fill={on ? "var(--color-computational)" : "var(--color-raised)"}
              stroke={on ? "var(--color-computational)" : "var(--color-ink)"}
              strokeWidth="1.1"
            />
            <path d={`M${x + 7.5} ${y} V${y + 7}`} stroke={on ? "var(--color-raised)" : "var(--color-ink)"} strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
}

function Chapter({
  id,
  title,
  lede,
  children,
}: {
  id?: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-20 scroll-mt-[calc(var(--header-h)+16px)]">
      <h2 className="m-0 font-display text-[clamp(26px,3.2vw,40px)] font-semibold tracking-[-0.025em] text-ink">
        {title}
      </h2>
      {lede ? <p className="m-0 mt-3 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">{lede}</p> : null}
      <div className="mt-7">{children}</div>
    </section>
  );
}
