import Link from "next/link";

import { StudyList, STUDY_NOTE } from "@/components/investigate";
import { DownloadButton } from "@/components/shell/DownloadButton";
import { CandidateFlow } from "@/components/story/CandidateFlow";
import { OrganismCell } from "@/components/story/diagrams";
import { Page } from "@/components/primitives";
import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { SearchField } from "@/components/search/SearchField";
import { StudiesToggle } from "@/components/investigate/StudiesToggle";
import { StudyTimeline } from "@/components/investigate/StudyTimeline";
import { conditionTerms, getStudies, getStudyTimeline } from "@/lib/queries/investigate";
import { getRepurposingSummary } from "@/lib/queries/repurposing";
import { DISCOVERY_THRESHOLD_TEXT } from "@/lib/science";
import { firstValue, numberParam, type RawSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * The dashboard: the search, the library and the repurposing candidates within
 * it, the four pathogens, the downloads and the registered studies. Every figure
 * is read from the database on this request, from the same definition the lists
 * and the CSV files use.
 */
export default async function Dashboard(props: { searchParams: Promise<RawSearchParams> }) {
  const params = await props.searchParams;
  const studyCondition = (firstValue(params, "sc") ?? "").trim();
  const studyPage = numberParam(params, "sp") ?? 1;

  const studyTerms = studyCondition ? conditionTerms(studyCondition, null) : undefined;
  const [summary, studies, timeline] = await Promise.all([
    getRepurposingSummary(),
    getStudies({ terms: studyTerms, page: studyPage }),
    getStudyTimeline(studyTerms),
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
          pathogens, and see what evidence is already documented for each one.
        </p>
        <div className="mt-8">
          <InvestigateSearch />
        </div>
      </header>

      <section aria-label="Dataset" className="mt-14 grid gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-3">
        <Figure
          value={n(summary.medicines)}
          label="Approved medicines"
          note="Approved medicines matched to the FDA Orange Book, antimicrobials included"
        />
        <Figure
          value={n(summary.withActivity)}
          label={`Medicines with ${DISCOVERY_THRESHOLD_TEXT} AI-predicted activity`}
          note="Against at least one of the four supported pathogens; each medicine counted once"
        />
        <Figure
          value={n(summary.candidates)}
          label="Repurposing candidates"
          note="Of those, the medicines that are not already antimicrobials"
          accent
        />
      </section>

      <section aria-labelledby="funnel-h" className="mt-4 rounded-card border border-rule bg-raised p-4 md:p-5">
        <h2 id="funnel-h" className="m-0 text-[13px] font-medium text-ink-2">
          How the repurposing candidates are counted
        </h2>
        <div className="mt-5">
          <CandidateFlow
            medicines={summary.medicines}
            withActivity={summary.withActivity}
            existingAntibacterials={summary.existingAntibacterials}
            needsReview={summary.needsReview}
            candidates={summary.candidates}
            threshold={DISCOVERY_THRESHOLD_TEXT}
          />
        </div>
        <p className="m-0 mt-3 text-[12px] leading-relaxed text-muted">
          Existing antimicrobials are identified from WHO ATC codes and FDA pharmacologic
          classes. Medicines needing review (neither source says whether they are
          antimicrobials) stay in the approved-medicine download, marked
          &ldquo;unclassified&rdquo;. They are not assumed to be non-antimicrobials, so they are
          not counted as candidates.
        </p>
      </section>

      <section aria-labelledby="downloads-h" className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-3">
        <h2 id="downloads-h" className="sr-only">
          Downloads
        </h2>
        <DownloadButton href="/api/export/approved-medicines">
          Download approved medicines (CSV)
          <span className="ml-2 font-mono text-[11px] font-normal opacity-70">{n(summary.medicines)} rows</span>
        </DownloadButton>
        <DownloadButton href="/api/export/repurposing-candidates">
          Download repurposing candidates (CSV)
          <span className="ml-2 font-mono text-[11px] font-normal opacity-70">{n(summary.candidates)} rows</span>
        </DownloadButton>
      </section>

      <section aria-labelledby="pathogens" className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
          <h2 id="pathogens" className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
            Pathogen coverage
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
                <span className="flex items-center gap-3">
                  <OrganismCell pathogen={p.key} size={44} />
                  <span>
                    <span className="block font-display text-[18px] font-semibold text-ink">
                      {p.label}
                    </span>
                    <span className="block text-[12px] italic text-muted">{p.fullName}</span>
                  </span>
                </span>
                <span className="mt-auto">
                  <span className="block font-mono text-[26px] font-medium tabular-nums leading-none text-computational">
                    {n(p.candidates)}
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-snug text-ink-2">
                    Repurposing candidates with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT}
                  </span>
                  {/* What reached the floor for this species, split three ways, on
                      one scale (the whole library) so the cards compare. */}
                  <span aria-hidden="true" className="amr-split mt-3 flex h-2 w-full">
                    {[
                      { v: p.candidates, c: "bg-computational" },
                      { v: p.existingAntibacterials, c: "bg-accent" },
                      { v: p.needsReview, c: "bg-faint" },
                    ].map((seg, i) => (
                      <span
                        key={i}
                        className={`block h-full ${seg.c}`}
                        style={{ width: `${summary.medicines ? (seg.v / summary.medicines) * 100 : 0}%` }}
                      />
                    ))}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted">
                    <span>{n(p.withActivity)} at {DISCOVERY_THRESHOLD_TEXT}:</span>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true" className="h-1.5 w-1.5 bg-computational" />
                      {n(p.candidates)} candidates
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true" className="h-1.5 w-1.5 bg-accent" />
                      {n(p.existingAntibacterials)} antimicrobials
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true" className="h-1.5 w-1.5 bg-faint" />
                      {n(p.needsReview)} needing review
                    </span>
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

        <form action="/dashboard#studies" method="get" className="mb-4 flex flex-wrap items-end gap-2.5">
          <div className="flex min-w-0 flex-1 basis-[300px] flex-col gap-1.5 sm:max-w-[620px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Condition</span>
            <div className="amr-filter flex items-center">
              <SearchField
                name="sc"
                source="conditions"
                label="Filter studies by condition"
                placeholder="All conditions, or type one, e.g. Tuberculosis"
                defaultValue={studyCondition}
                submitOnSelect
                className="min-w-0 flex-1"
                inputClassName="amr-search-input"
              />
              <button type="submit" className="amr-search-go amr-search-go-sm">
                Filter
              <span aria-hidden="true" className="amr-search-go-cap">
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              </button>
            </div>
          </div>
          <StudiesToggle target="studies-body" total={studies.total} />
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

        <div id="studies-body">
        <StudyTimeline data={timeline} total={studies.total} />
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
        </div>
      </section>

      <p className="m-0 mt-12 max-w-[80ch] border-t border-rule pt-4 text-[12px] leading-relaxed text-muted">
        AI-predicted activity is a model&rsquo;s estimate that a molecule is active against a
        pathogen in the laboratory. It is not clinical effectiveness. The models describe each
        pathogen species; the data behind them rarely records resistant strains.
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
