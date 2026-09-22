import { DistributionBars } from "@/components/data";
import {
  Breadcrumb,
  KPI,
  LimitationCallout,
  MetricGrid,
  Page,
  PageHeader,
  Section,
  WarningCallout,
  num,
} from "@/components/primitives";
import {
  getClinicalOverview,
  getTopTrialConditions,
  getTrialBreakdown,
} from "@/lib/queries/analysis";

export const revalidate = 300;

/**
 * Clinical Evidence.
 *
 * The registry sweep, reported as what it is: a retrieval. Every figure here
 * counts registrations, and the page repeats in three places that a
 * registration is neither a result nor an approval, because this is the surface
 * where a reader is most likely to mistake coverage for evidence.
 */
export default async function ClinicalPage() {
  const [overview, phases, statuses, types, conditions] = await Promise.all([
    getClinicalOverview(),
    getTrialBreakdown("phase", 10),
    getTrialBreakdown("overall_status", 10),
    getTrialBreakdown("study_type", 6),
    getTopTrialConditions(15),
  ]);

  const notChecked = Math.max(0, overview.medicinesTotal - overview.medicinesQueried);
  const checkedPercent =
    overview.medicinesTotal > 0
      ? (overview.medicinesQueried / overview.medicinesTotal) * 100
      : null;

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Evidence", "Clinical"]} />
      <PageHeader
        eyebrow="Evidence"
        title="Clinical Evidence"
        lede="What ClinicalTrials.gov returned for the medicines in this library — how much of the library was asked about, and what came back."
      />

      <Section title="Registry coverage" note={`last retrieved ${overview.lastRetrieved ?? "—"}`}>
        <MetricGrid>
          <KPI
            value={`${num(overview.medicinesQueried)} / ${num(overview.medicinesTotal)}`}
            label={`Medicines queried${checkedPercent === null ? "" : ` · ${checkedPercent.toFixed(1)}% of the library`}`}
            source="COUNT(*) in clinical_queries"
          />
          <KPI
            value={num(notChecked)}
            label="Medicines not yet checked"
            source="library minus clinical_queries"
          />
          <KPI
            value={num(overview.queriesFailed)}
            label="Queries that failed"
            source="clinical_queries WHERE status <> 'ok'"
          />
          <KPI
            value={num(overview.medicinesWithNoResults)}
            label="Queried and returned nothing"
            source="clinical_queries WHERE n_results = 0"
          />
          <KPI
            value={num(overview.distinctStudies)}
            label="Distinct registered studies"
            source={`COUNT(DISTINCT nct_id) · ${num(overview.trialLinks)} medicine links`}
          />
          <KPI
            value={num(overview.amrRelatedLinks)}
            label="Links matching an AMR keyword"
            source="clinical_trials WHERE amr_related"
          />
        </MetricGrid>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <WarningCallout title="Coverage is not evidence">
            A complete sweep means every medicine was asked about. It does not mean the
            evidence is complete: the registry records studies that were registered, not
            studies that worked, and a medicine with many registrations has not thereby
            been shown to do anything.
          </WarningCallout>
          <LimitationCallout title="Three states, kept apart">
            <strong>Not yet checked</strong> is a medicine nobody has queried.{" "}
            <strong>No evidence found</strong> is a medicine that was queried and returned
            nothing. Neither is <strong>evidence of no effect</strong>, and this page never
            collapses them into one number.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="What came back" note="counts of registrations">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Phase
            </h3>
            <DistributionBars rows={phases} unit="phase" />
            <p className="m-0 mt-3 max-w-[60ch] text-[12px] leading-relaxed text-muted">
              A phase describes what a study was designed to do, not what it found. Many
              registrations record no phase at all, and those are labelled rather than
              dropped.
            </p>
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Overall status
            </h3>
            <DistributionBars rows={statuses} unit="status" />
            <p className="m-0 mt-3 max-w-[60ch] text-[12px] leading-relaxed text-muted">
              &ldquo;Completed&rdquo; means the study finished. It does not mean the
              intervention worked, and this system does not read results from the
              registry.
            </p>
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Study type
            </h3>
            <DistributionBars rows={types} unit="study type" />
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Most frequently named conditions
            </h3>
            <DistributionBars rows={conditions} unit="condition" />
            <p className="m-0 mt-3 max-w-[60ch] text-[12px] leading-relaxed text-muted">
              Conditions are counted as the registry spells them, so two spellings of one
              condition count separately. This is a retrieval summary, not a curated
              vocabulary.
            </p>
          </div>
        </div>
      </Section>

      <Section title="How this sweep was made">
        <div className="grid gap-4 lg:grid-cols-3">
          <LimitationCallout title="Queried by name">
            Each medicine was queried by its generic name. A study that names only a brand,
            a salt form or a combination product may not have been retrieved, so a zero
            here is a zero for that query rather than for the literature.
          </LimitationCallout>
          <LimitationCallout title="Keyword matching is not classification">
            The AMR flag comes from matching keywords in the retrieved record. It marks a
            record worth reading; it does not establish that the study concerned resistant
            infection.
          </LimitationCallout>
          <LimitationCallout title="Registration ≠ approval">
            A registered trial is not a successful trial, and approval of a medicine for
            one indication is not approval for another. Nothing on this site treats a
            registration as support for a new use.
          </LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}
