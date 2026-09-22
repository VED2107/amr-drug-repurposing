import Link from "next/link";
import {
  Breadcrumb,
  KPI,
  LimitationCallout,
  MetricGrid,
  Page,
  PageHeader,
  Section,
  num,
} from "@/components/primitives";
import { EvidenceIndicator } from "@/components/evidence/EvidenceIndicator";
import { getCoverageSummary, getModelVersions, getPathogens, getPipelineRuns } from "@/lib/queries/core";
import { PATHOGEN_PLAIN } from "@/lib/content";
import { RESISTANCE_LIMITATION } from "@/lib/science";

/*
  Rendered per request rather than prerendered at build time.

  Every page here reads live counts from Supabase. Prerendering them made the
  *build* depend on reaching the database, which meant a deployment could fail
  for a reason that has nothing to do with the code — a connection string, a
  network route, a paused project. Rendering on request keeps the build a pure
  function of the repository, and has the side benefit that a figure is never
  older than the request that asked for it.
*/
export const dynamic = "force-dynamic";

/**
 * Dashboard.
 *
 * Operational density: the same design language as the Overview, tightened.
 * Where the Overview gives an idea a full viewport, this gives it a row.
 * Nothing is summarised into a single "score" — the surfaces stay separate
 * because collapsing them is what would let a reader mistake one kind of
 * evidence for another.
 */
export default async function DashboardPage() {
  const [coverage, pathogens, models, runs] = await Promise.all([
    getCoverageSummary(),
    getPathogens(),
    getModelVersions(true),
    getPipelineRuns(8),
  ]);

  const clinicalPercent =
    coverage.clinicalTotal > 0 ? (coverage.clinicalChecked / coverage.clinicalTotal) * 100 : null;
  const dockedPercent =
    coverage.approvedMedicines > 0
      ? (coverage.dockedMedicines / coverage.approvedMedicines) * 100
      : null;

  return (
    <Page>
      <Breadcrumb trail={["AMR Research", "Dashboard"]} />
      <PageHeader
        eyebrow="Research overview"
        title="Dashboard"
        lede="Every figure on this page is counted from the database at render time. Running a pipeline stage changes what it says."
      />

      <Section title="Library and evidence" note="live counts">
        <MetricGrid>
          <KPI value={num(coverage.approvedMedicines)} label="Approved medicines with a structure" source="COUNT(DISTINCT molecule_id) in drugs" />
          <KPI value={num(coverage.validStructures)} label="Valid molecular structures" source="molecules WHERE is_valid" />
          <KPI value={num(coverage.labelledBioactivity)} label="Labelled bioactivity records" source="bioactivity WHERE label IS NOT NULL" />
          <KPI value={num(coverage.distinctStudies)} label="Distinct registered studies" source={`clinical_trials · ${num(coverage.trialLinks)} medicine links`} />
          <KPI value={num(coverage.storedPoses)} label="Stored docking poses" source="docking_results WHERE status = 'ok'" />
          <KPI value={num(coverage.activePredictions)} label="Predictions from ACTIVE models" source={`${coverage.activeModels} ACTIVE model versions`} />
        </MetricGrid>
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="Coverage" note="what has and has not been checked">
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2">
          <CoverageBar
            title="Clinical evidence"
            checked={coverage.clinicalChecked}
            total={coverage.clinicalTotal}
            percent={clinicalPercent}
            checkedLabel="queried at ClinicalTrials.gov"
            restLabel="not yet checked"
            color="var(--color-clinical)"
          />
          <CoverageBar
            title="Docking"
            checked={coverage.dockedMedicines}
            total={coverage.approvedMedicines}
            percent={dockedPercent}
            checkedLabel="has at least one stored pose"
            restLabel="not yet docked"
            color="var(--color-violet)"
          />
        </div>

        <div className="mt-6">
          <LimitationCallout title="Read this before the numbers above">
            The unchecked remainder is <strong>not yet checked</strong>, which is a
            different statement from <strong>no evidence found</strong>, and neither of
            them means <strong>no effect</strong>. The interface keeps these apart
            everywhere they appear.
          </LimitationCallout>
        </div>
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="Evidence states" note="the five rungs, never collapsed">
        <div className="flex flex-wrap gap-2">
          <EvidenceIndicator value="clinical" />
          <EvidenceIndicator value="experimental" />
          <EvidenceIndicator value="computational" />
          <EvidenceIndicator value="none" />
          <EvidenceIndicator value="unchecked" />
        </div>
        <p className="m-0 mt-4 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
          A medicine sits on exactly one rung for a given condition.{" "}
          <Link href="/explorer">Medicine × Disease</Link> shows how a pairing is
          classified and what each rung does not establish.
        </p>
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="The four modelled bacteria" note={`${models.length} ACTIVE models`}>
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2 xl:grid-cols-4">
          {pathogens.map((p) => {
            const model = models.find((m) => m.pathogenKey === p.key) ?? null;
            const plain = PATHOGEN_PLAIN[p.key];
            return (
              <article key={p.key} className="bg-raised p-5">
                <h3 className="m-0 font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
                  {p.label}
                </h3>
                <p className="m-0 mt-1 font-mono text-[11px] italic text-muted">{p.fullName}</p>
                {plain ? (
                  <p className="m-0 mt-3 text-[12px] leading-relaxed text-ink-2">{plain.plain}</p>
                ) : null}
                <dl className="m-0 mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-rule-soft pt-3">
                  <dt className="text-[12px] text-ink-2">Active model</dt>
                  <dd className="m-0 font-mono text-[11px] text-ink">
                    {model?.modelVersion ?? "none"}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Validation</dt>
                  <dd className="m-0 font-mono text-[11px] text-ink">
                    {model?.validationMethod ?? "—"}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Split</dt>
                  <dd className="m-0 font-mono text-[11px] text-ink">
                    {model?.splitMethod ?? "—"}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Test set</dt>
                  <dd className="m-0 font-mono text-[11px] tabular-nums text-ink">
                    {num(model?.nTest ?? null)}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Resistant-strain coverage</dt>
                  <dd className="m-0 font-mono text-[11px] tabular-nums text-ink">
                    {p.resistantStrainFraction === null
                      ? "—"
                      : `${(p.resistantStrainFraction * 100).toFixed(1)}%`}
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>
        <div className="mt-6">
          <LimitationCallout title="What these models represent">{RESISTANCE_LIMITATION}</LimitationCallout>
        </div>
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="Recent pipeline runs" note={`${runs.length} shown`}>
        {runs.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No runs recorded in this database.</p>
        ) : (
          <div className="scroll-x border border-rule">
            <table className="w-full min-w-[720px] text-left">
              <caption className="sr-only">Most recent pipeline runs</caption>
              <thead>
                <tr className="bg-sunken">
                  {["Stage", "Started", "Status", "Processed", "New", "Errors"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-rule px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className="border-b border-rule-soft">
                    <td className="px-3 py-2.5 font-display text-[13px] text-ink">{r.stage}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">
                      {r.startedAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">{r.status}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-ink">
                      {num(r.recordsProcessed)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-ink">
                      {num(r.recordsNew)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-ink">
                      {num(r.errorCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 mt-4 text-[13px]">
          <Link href="/runs">Full run history</Link>
        </p>
      </Section>
    </Page>
  );
}

function CoverageBar({
  title,
  checked,
  total,
  percent,
  checkedLabel,
  restLabel,
  color,
}: {
  title: string;
  checked: number;
  total: number;
  percent: number | null;
  checkedLabel: string;
  restLabel: string;
  color: string;
}) {
  const rest = total - checked;
  return (
    <div className="bg-raised p-5">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{title}</p>
      <p className="m-0 mt-2 font-display text-[clamp(22px,2.4vw,32px)] leading-none tracking-[-0.02em] text-ink">
        {num(checked)}
        <span className="text-fainter"> / {num(total)}</span>
      </p>
      <div
        role="img"
        aria-label={`${checked} of ${total} ${checkedLabel}; ${rest} ${restLabel}`}
        className="mt-3 flex h-[28px] items-stretch border border-rule bg-paper"
      >
        <div style={{ width: `${percent ?? 0}%`, background: color }} />
        <div
          className="flex-1"
          style={{
            background: "repeating-linear-gradient(90deg,#E6E1D6 0 1px,transparent 1px 7px)",
          }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 font-mono text-[10px] text-muted">
        <span>
          {checkedLabel}
          {percent !== null ? ` · ${percent.toFixed(1)}%` : null}
        </span>
        <span>
          {restLabel} · {num(rest)}
        </span>
      </div>
    </div>
  );
}
