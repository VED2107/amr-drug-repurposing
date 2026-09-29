import Link from "next/link";

import { StudyList, STUDY_NOTE } from "@/components/investigate";
import { Page } from "@/components/primitives";
import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { SearchField } from "@/components/search/SearchField";
import { conditionTerms, getStudies } from "@/lib/queries/investigate";
import { getRepurposingSummary } from "@/lib/queries/repurposing";
import { DISCOVERY_THRESHOLD_TEXT } from "@/lib/science";
import { firstValue, numberParam, type RawSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * The dashboard: the search, the library and the repurposing candidates within
 * it, the four bacteria, the downloads and the registered studies. Every figure
 * is read from the database on this request, from the same definition the lists
 * and the CSV files use.
 */
export default async function Dashboard(props: { searchParams: Promise<RawSearchParams> }) {
  const params = await props.searchParams;
  const studyCondition = (firstValue(params, "sc") ?? "").trim();
  const studyPage = numberParam(params, "sp") ?? 1;

  const [summary, studies] = await Promise.all([
    getRepurposingSummary(),
    getStudies({
      terms: studyCondition ? conditionTerms(studyCondition, null) : undefined,
      page: studyPage,
    }),
  ]);

  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <Page>
      <header className="max-w-[860px] pt-4 md:pt-10">
        <h1 className="m-0 font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Research dashboard
        </h1>
        <p className="m-0 mt-4 max-w-[58ch] text-[16px] leading-relaxed text-ink-2">
          Search approved medicines for AI-predicted activity against four drug-resistant
          bacteria, and see what evidence is already documented for each one.
        </p>
        <div className="mt-8">
          <InvestigateSearch />
        </div>
      </header>

      <section aria-label="Dataset" className="mt-14 grid gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-3">
        <Figure
          value={n(summary.medicines)}
          label="Approved medicines"
          note="Approved medicines matched to the FDA Orange Book, antibacterials included"
        />
        <Figure
          value={n(summary.withActivity)}
          label={`Medicines with ${DISCOVERY_THRESHOLD_TEXT} AI-predicted activity`}
          note="Against at least one of the four supported pathogens; each medicine counted once"
        />
        <Figure
          value={n(summary.candidates)}
          label="Repurposing candidates"
          note="Of those, the medicines that are not already antibacterials"
          accent
        />
      </section>

      <section aria-labelledby="funnel-h" className="mt-4 rounded-card border border-rule bg-raised p-4 md:p-5">
        <h2 id="funnel-h" className="m-0 text-[13px] font-medium text-ink-2">
          How the repurposing candidates are counted
        </h2>
        <ol className="m-0 mt-3 grid list-none gap-2 p-0 text-[13px] sm:grid-cols-2 lg:grid-cols-5">
          <Stage value={n(summary.medicines)} text="approved medicines" />
          <Stage
            value={n(summary.withActivity)}
            text={`with AI-predicted activity ${DISCOVERY_THRESHOLD_TEXT} against at least one pathogen`}
          />
          <Stage
            value={`− ${n(summary.existingAntibacterials)}`}
            text="already antibacterial medicines, set aside (WHO ATC and FDA classification)"
          />
          <Stage
            value={`− ${n(summary.needsReview)}`}
            text="needing review: no WHO ATC code or FDA class says whether they are antibacterials"
          />
          <Stage value={n(summary.candidates)} text="repurposing candidates" accent />
        </ol>
        <p className="m-0 mt-3 text-[12px] leading-relaxed text-muted">
          Medicines needing review stay in the approved-medicine download, marked
          &ldquo;unclassified&rdquo;. They are not assumed to be non-antibacterials, so they are
          not counted as candidates.
        </p>
      </section>

      <section aria-labelledby="downloads-h" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 id="downloads-h" className="sr-only">
          Downloads
        </h2>
        <a href="/api/export/approved-medicines" download className="amr-btn-quiet">
          Download approved medicines (CSV)
          <span className="font-mono text-[11px] font-normal text-muted">{n(summary.medicines)} rows</span>
        </a>
        <a href="/api/export/repurposing-candidates" download className="amr-btn-quiet">
          Download repurposing candidates (CSV)
          <span className="font-mono text-[11px] font-normal text-muted">{n(summary.candidates)} rows</span>
        </a>
      </section>

      <section aria-labelledby="pathogens" className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
          <h2 id="pathogens" className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
            AI-supported pathogens
          </h2>
          <p className="m-0 text-[13px] text-muted">A medicine can count under more than one</p>
        </div>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {summary.pathogens.map((p) => (
            <li key={p.key}>
              <Link
                href={`/investigate?pathogen=${p.key}`}
                className="amr-card group flex h-full flex-col gap-4 rounded-card border border-rule bg-raised p-4 no-underline md:p-5"
              >
                <span>
                  <span className="block font-display text-[18px] font-semibold text-ink">
                    {p.label}
                  </span>
                  <span className="block text-[12px] italic text-muted">{p.fullName}</span>
                </span>
                <span className="mt-auto">
                  <span className="block font-mono text-[26px] font-medium tabular-nums leading-none text-computational">
                    {n(p.candidates)}
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-snug text-ink-2">
                    Repurposing candidates with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT}
                  </span>
                  <span aria-hidden="true" className="mt-3 block h-1 rounded-full bg-sunken">
                    <span
                      className="block h-full rounded-full bg-computational"
                      style={{ width: `${summary.medicines ? (p.candidates / summary.medicines) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="mt-1.5 block font-mono text-[11px] tabular-nums text-muted">
                    {n(p.withActivity)} at {DISCOVERY_THRESHOLD_TEXT}, less {n(p.existingAntibacterials)} antibacterials and {n(p.needsReview)} needing review
                  </span>
                </span>
                <span className="text-[13px] font-medium text-ink decoration-accent underline-offset-4 group-hover:underline">
                  See all {n(p.candidates)} candidates →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="studies" aria-labelledby="studies-h" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
          <h2 id="studies-h" className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
            Registered studies
          </h2>
          <p className="m-0 text-[13px] text-muted">{STUDY_NOTE}</p>
        </div>

        <form action="/dashboard#studies" method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-[260px] flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">Condition</span>
            <SearchField
              name="sc"
              source="conditions"
              label="Filter studies by condition"
              placeholder="All conditions"
              defaultValue={studyCondition}
              submitOnSelect
            />
          </label>
          <button type="submit" className="amr-btn-quiet">
            Filter
          </button>
          {studyCondition ? (
            <Link href="/dashboard#studies" className="amr-btn-quiet">
              All conditions
            </Link>
          ) : null}
        </form>

        {studyCondition ? (
          <p className="m-0 mb-3 text-[13px] text-ink-2">
            {n(studies.total)} registered {studies.total === 1 ? "study" : "studies"} whose
            listed conditions mention &ldquo;{studyCondition}&rdquo;.
          </p>
        ) : null}

        <StudyList
          data={studies}
          path="/dashboard"
          params={params}
          anchor="studies"
          pageParam="sp"
          empty={
            <>
              No registered study in this dataset lists a condition mentioning &ldquo;
              {studyCondition}&rdquo;. That is no evidence found here, not evidence of no effect.
            </>
          }
        />
      </section>

      <p className="m-0 mt-12 max-w-[80ch] border-t border-rule pt-4 text-[12px] leading-relaxed text-muted">
        AI-predicted activity is a model&rsquo;s estimate that a molecule is active against a
        bacterium in the laboratory. It is not clinical effectiveness. The models describe each
        bacterial species; the data behind them rarely records resistant strains.
      </p>
    </Page>
  );
}

function Figure({
  value,
  label,
  note,
  accent = false,
}: {
  value: string;
  label: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-raised p-5 md:p-6">
      <p
        className="m-0 font-mono text-[clamp(30px,3.6vw,46px)] font-medium tabular-nums leading-none"
        style={{ color: accent ? "var(--color-computational)" : "var(--color-ink)" }}
      >
        {value}
      </p>
      <p className="m-0 mt-3 font-display text-[15px] font-semibold leading-snug text-ink">{label}</p>
      {note ? <p className="m-0 mt-1 text-[12px] leading-snug text-muted">{note}</p> : null}
    </div>
  );
}

function Stage({ value, text, accent = false }: { value: string; text: string; accent?: boolean }) {
  return (
    <li className="rounded-card bg-paper p-3">
      <span
        className="block font-mono text-[20px] font-medium tabular-nums leading-none"
        style={{ color: accent ? "var(--color-computational)" : "var(--color-ink)" }}
      >
        {value}
      </span>
      <span className="mt-1.5 block text-[12px] leading-snug text-ink-2">{text}</span>
    </li>
  );
}
