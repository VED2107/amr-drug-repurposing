import Link from "next/link";

import { EvidenceIcon } from "@/components/investigate";
import { Page } from "@/components/primitives";
import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { BacteriaBench } from "@/components/story/BacteriaBench";
import { Pipeline } from "@/components/story/Pipeline";
import { HeroMotif } from "@/components/story/HeroMotif";
import { MethodLink } from "@/components/story/MethodLink";
import { OrganismCell } from "@/components/story/diagrams";
import { REPURPOSING_EXAMPLES } from "@/lib/content";
import { getRepurposingSummary } from "@/lib/queries/repurposing";
import { getStoryFigures, type StoryFigures } from "@/lib/queries/story";
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
          <p className="m-0 mt-6 max-w-[60ch] text-pretty text-[17px] leading-relaxed text-ink-2">
            Multi-drug resistant superbugs are evolving faster than our ability to create treatments,
            causing 1.27&nbsp;million deaths globally every year.
            <a
              href="https://doi.org/10.1016/S0140-6736(21)02724-0"
              target="_blank"
              rel="noreferrer"
              className="amr-cite"
              title="Antimicrobial Resistance Collaborators, The Lancet, 2022: deaths directly attributable to resistant infections, estimated for 2019"
            >
              <sup>1</sup>
              <span className="sr-only">Source: The Lancet, 2022</span>
            </a> This model asks a faster question:
            could a medicine that is <strong className="font-semibold text-ink">already approved</strong>{" "}
            for something else also act against a drug-resistant superbug?
          </p>
          <div className="mt-8 max-w-[600px]">
            <HeroMotif />
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
          sources={figures.molecularSources}
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
            <li key={e.name} className="amr-repurpose flex flex-col rounded-card border border-rule bg-raised p-5 md:p-6">
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
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{e.fromLabel ?? "First used for"}</span>
                  <span className="mt-1 block text-[14px] leading-snug text-ink-2">{e.from}</span>
                </p>
                <span aria-hidden="true" className="amr-track-v-node mt-4 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-accent text-[9px] leading-none text-paper">
                  ↓
                </span>
                <p className="m-0 mt-3.5">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-accent">{e.toLabel ?? "Later also used for"}</span>
                  <span className="mt-1 block text-[14px] leading-snug text-ink">{e.to}</span>
                </p>
              </div>
              {e.note ? (
                <p className="m-0 mt-auto pt-4">
                  <span className="block border-t border-rule-soft pt-3 font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-muted">
                    {e.note}
                  </span>
                </p>
              ) : null}
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
            docking: figures.docking,
            registryChecked: figures.registryChecked,
          }}
        />
      </Chapter>

      {/* --- Pathogens ------------------------------------------------------ */}
      <section id="how-the-models-learned" aria-label="The full method" className="mt-14">
        <MethodLink />
      </section>

      <Chapter
        id="bacteria"
        title="Four pathogens. Four different resistance problems."
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
            are not predictions for every pathogen species or every resistant strain: the models learn
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
 * The broader molecular dataset is read as provenance: where its structures
 * come from, split to scale. The approved-medicine library that is actually
 * screened is a separate sheet, a unit chart of capsules with its repurposing
 * candidates marked in indigo. Registered studies count studies, not
 * medicines, so they are listed beside the chart rather than drawn in it.
 */
function PopulationPanel({
  molecules,
  sources,
  medicines,
  candidates,
  studies,
}: {
  molecules: number;
  sources: StoryFigures["molecularSources"];
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
      {/* Sheet one: the broader molecular dataset, read as provenance. */}
      <MolecularSources total={molecules} sources={sources} />

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
          <UnitField count={pills} marked={marked} />
          {/* The bracket: under the indigo capsules, naming what they are. */}
          <div className="amr-key-candidates relative mt-1.5" style={{ width: `${(marked / pills) * 100}%` }}>
            <span aria-hidden="true" className="amr-bracket block h-2 border-x border-b border-computational" />
            <p className="m-0 mt-2 font-mono text-[26px] font-medium tabular-nums leading-none text-computational">
              {n(candidates)}
            </p>
          </div>
          <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink-2">
            repurposing candidates: not already antibacterials, with AI-predicted activity{" "}
            {DISCOVERY_THRESHOLD_TEXT} against at least one pathogen
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
          One capsule ≈ {UNIT} medicines. Rounded.
        </p>
      </div>
    </div>
  );
}

/**
 * Where the broader molecular dataset comes from. Every structure carries a
 * ChEMBL identifier and was standardised before use; the bar splits the total
 * into three parts that sum to it, so the reader can see how few of the
 * structures are approved medicines. Unreadable structures are counted, not
 * drawn: they were dropped, not repaired.
 */
function MolecularSources({
  total,
  sources,
}: {
  total: number;
  sources: StoryFigures["molecularSources"];
}) {
  const n = (v: number) => v.toLocaleString("en-GB");
  const parts = [
    { key: "lab", value: sources.labTested, label: "other compounds with laboratory records against the four pathogens", tone: "bg-experimental" },
    { key: "library", value: sources.library, label: "approved medicines in the FDA screening library", tone: "bg-ink" },
    { key: "other", value: sources.other, label: "other ChEMBL drug entries outside that library", tone: "bg-rule-strong" },
  ].filter((p) => p.value > 0);
  return (
    <div className="amr-key-molecules amr-prov rounded-card border border-rule bg-raised px-6 py-5 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Broader molecular dataset</p>
        <p className="m-0 inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-experimental" />
          Source · ChEMBL
        </p>
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
        <div>
          <p className="m-0 font-mono text-[clamp(46px,5vw,68px)] font-medium leading-[0.85] tracking-[-0.04em] text-ink">
            {`${Math.floor(total / 1000)}K`}
          </p>
          <p className="m-0 mt-3 text-[15px] font-medium leading-snug text-ink">Molecular structures</p>
          <p className="m-0 mt-1 max-w-[30ch] text-[13px] leading-snug text-ink-2">
            Extracted from ChEMBL, an open database of bioactive molecules
          </p>
        </div>

        <dl className="m-0 grid gap-1.5">
          {parts.map((p, i) => (
            <div
              key={p.key}
              data-part={p.key}
              className="amr-prov-row grid grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-x-2.5"
              style={{ ["--i" as string]: i }}
            >
              <span aria-hidden="true" className={`h-2 w-2 translate-y-[-1px] rounded-[2px] ${p.tone}`} />
              <dt className="text-[12.5px] leading-snug text-ink-2">{p.label}</dt>
              <dd className="m-0 font-mono text-[12.5px] tabular-nums text-ink">{n(p.value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* The split, drawn to scale. */}
      <div className="amr-prov-bar mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
        {parts.map((p, i) => (
          <span
            key={p.key}
            data-part={p.key}
            className={`amr-prov-seg block h-full ${p.tone}`}
            style={{ flexGrow: p.value, flexBasis: 0, minWidth: 3, ["--i" as string]: i }}
          />
        ))}
      </div>

      <p className="m-0 mt-3 font-mono text-[10.5px] leading-relaxed text-faint">
        {n(total)} valid structures, each counted once.{" "}
        {sources.libraryWithLab > 0
          ? `The ${n(sources.library)} library medicines include ${n(sources.libraryWithLab)} that also have laboratory records, so ${n(sources.labTested + sources.libraryWithLab)} structures have records in all.`
          : ""}
        {sources.dropped > 0 ? ` ${n(sources.dropped)} that could not be read were dropped, not repaired.` : ""}
      </p>
    </div>
  );
}

/**
 * The approved-medicine library as a row of capsules, one per ~100; the first
 * `marked` are the repurposing candidates, in indigo.
 */
function UnitField({ count, marked = 0 }: { count: number; marked?: number }) {
  const SX = 20;
  const SY = 12;
  return (
    <svg
      viewBox={`0 0 ${count * SX} ${SY + 2}`}
      className="amr-units amr-units-pill block h-auto w-full max-w-[400px]"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => {
        const style = { ["--r" as string]: 0, ["--c" as string]: i };
        const x = i * SX + 2;
        const y = 2;
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
