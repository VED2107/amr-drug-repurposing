import type { BuildInfo } from "@/lib/queries/build";
import { Mark } from "./Mark";

/**
 * The colophon.
 *
 * Set the way a journal sets the note at the end of an issue: what this is and
 * what it is not, where every record came from, and exactly which build of the
 * data the reader has been looking at. Paper, hairline rules, mono for anything
 * that is an identifier — the same instrument as the pages above it, not a
 * different product bolted on underneath.
 *
 * There is no link list. Inside the application the research index is always
 * present, so repeating it here would be a sitemap for its own sake.
 *
 * The build column is read from the database on every request — the ACTIVE
 * models' dataset and feature versions, the latest pipeline run and the data
 * version the page was rendered at — because a figure without its build is not
 * reproducible. Nothing in it is typed in.
 */

const SOURCES: { name: string; role: string }[] = [
  { name: "ChEMBL", role: "bioactivity and approved molecules" },
  { name: "FDA Orange Book", role: "approved products" },
  { name: "ClinicalTrials.gov", role: "registered studies" },
  { name: "RCSB PDB", role: "target structures" },
  { name: "AutoDock Vina", role: "docking poses" },
];

export function Footer({ build }: { build: BuildInfo }) {
  const unavailable = "unavailable";

  return (
    <footer className="border-t border-rule bg-paper">
      <div className="mx-auto max-w-shell px-4 md:px-8 lg:px-12">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-4">
          <p className="m-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Colophon</p>
          <p className="m-0 font-mono text-[10px] text-faint">
            data version {build.dataVersion ?? unavailable}
          </p>
        </div>

        <div className="grid gap-x-12 gap-y-9 py-9 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-3 font-display text-[clamp(20px,1.8vw,24px)] font-normal leading-tight tracking-[-0.02em] text-ink">
              <Mark size={28} />
              AMR Research
            </p>
            <p className="m-0 mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Smart Screening · research prototype
            </p>
            <p className="m-0 mt-4 max-w-[46ch] text-[13px] leading-relaxed text-ink-2">
              Scores already-approved medicines for AI-predicted activity against four
              drug-resistant bacteria, and shows what evidence exists for each one.
            </p>
          </div>

          <div className="min-w-0">
            <ColophonLabel>Sources</ColophonLabel>
            <dl className="m-0">
              {SOURCES.map((source) => (
                <div
                  key={source.name}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule-soft py-1.5"
                >
                  <dt className="font-display text-[13px] text-ink">{source.name}</dt>
                  <dd className="m-0 font-mono text-[10px] text-muted">{source.role}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="min-w-0">
            <ColophonLabel>Build</ColophonLabel>
            <dl className="m-0">
              <BuildRow term="dataset" value={build.datasetVersion ?? unavailable} />
              <BuildRow term="features" value={build.featureVersion ?? unavailable} />
              <BuildRow term="last pipeline run" value={build.snapshot ?? unavailable} />
              <BuildRow term="data version" value={build.dataVersion ?? unavailable} />
            </dl>
          </div>
        </div>

        <p className="m-0 border-t border-rule py-4 text-[12px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">Not medical advice.</strong> No output here
          establishes that a medicine treats a disease or supports a change in treatment.
        </p>
      </div>
    </footer>
  );
}

function ColophonLabel({ children }: { children: string }) {
  return (
    <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{children}</p>
  );
}

function BuildRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 border-b border-rule-soft py-1.5 font-mono text-[11px]">
      <dt className="text-muted">{term}</dt>
      <dd className="m-0 min-w-0 break-all text-ink">{value}</dd>
    </div>
  );
}
