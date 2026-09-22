import Link from "next/link";

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
import { getClinicalOverview, getDockingCoverage } from "@/lib/queries/analysis";
import { getCoverageSummary, getPathogens } from "@/lib/queries/core";
import { DOCKING_SCREENING_TARGET_KCAL_MOL, RESISTANCE_LIMITATION } from "@/lib/science";

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
 * Roadmap.
 *
 * Two lists: what is missing from what is built, and what was never built. The
 * first is measured live, so a gap closes on this page only when it closes in
 * the database. The second is copied from the project's own future-work slide
 * and is written in the future tense throughout, because the most common way a
 * roadmap misleads is by describing a plan in the present tense.
 */
export default async function RoadmapPage() {
  const [coverage, clinical, docking, pathogens] = await Promise.all([
    getCoverageSummary(),
    getClinicalOverview(),
    getDockingCoverage(DOCKING_SCREENING_TARGET_KCAL_MOL),
    getPathogens(),
  ]);

  const notDocked = coverage.approvedMedicines - coverage.dockedMedicines;
  const notChecked = Math.max(0, clinical.medicinesTotal - clinical.medicinesQueried);

  const worstPhenotype = [...pathogens].sort(
    (a, b) => (a.resistantStrainFraction ?? 0) - (b.resistantStrainFraction ?? 0),
  )[0];

  return (
    <Page>
      <Breadcrumb trail={["AMR Research", "Roadmap"]} />
      <PageHeader
        eyebrow="Roadmap"
        title="What is not built yet"
        lede="The gaps in what exists, measured from the database, and the work that was never started."
      />

      <Section title="Gaps in what exists" note="measured at render time">
        <MetricGrid>
          <KPI
            value={num(notDocked)}
            label="Medicines not yet docked"
            source={`${num(coverage.dockedMedicines)} of ${num(coverage.approvedMedicines)} have a stored pose`}
          />
          <KPI
            value={num(notChecked)}
            label="Medicines not yet queried at the registry"
            source={`${num(clinical.medicinesQueried)} of ${num(clinical.medicinesTotal)} queried`}
          />
          <KPI
            value={num(clinical.medicinesWithNoResults)}
            label="Queried and returned nothing"
            source="no evidence found — not evidence of no effect"
          />
          <KPI
            value={num(docking.targets)}
            label="Receptors prepared"
            source="one target per modelled pathogen"
          />
          <KPI
            value={
              worstPhenotype?.resistantStrainFraction === null ||
              worstPhenotype?.resistantStrainFraction === undefined
                ? "—"
                : `${(worstPhenotype.resistantStrainFraction * 100).toFixed(1)}%`
            }
            label={`Lowest resistant-strain coverage (${worstPhenotype?.label ?? "—"})`}
            source="bioactivity WHERE strain_specific"
          />
          <KPI
            value={num(coverage.activeModels)}
            label="Pathogens with a model"
            source="four — nothing else shows a probability"
          />
        </MetricGrid>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <WarningCallout title="The largest gap is not a number on this page">
            {RESISTANCE_LIMITATION} Closing it needs measurements against named resistant
            strains, not more compute — no amount of retraining on species-level labels
            produces a resistance-phenotype model.
          </WarningCallout>
          <LimitationCallout title="Why these are stated rather than smoothed">
            Every gap above is visible on the surface it affects:{" "}
            <Link href="/docking">Docking</Link> says what has not been docked,{" "}
            <Link href="/clinical">Clinical</Link> says what has not been checked, and{" "}
            <Link href="/screening">Screening</Link> marks the medicines the models were
            trained on.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Never started" note="future work in the project's own terms">
        <ul className="m-0 grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-2">
          {[
            {
              title: "Graph neural networks",
              body: "The current models read fingerprints and descriptors. A graph model would read the molecule as a graph instead. Nothing of the sort has been trained here, and no result on this site came from one.",
            },
            {
              title: "Combination therapy",
              body: "Every prediction on this site concerns a single molecule against a single organism. Combinations behave differently from their parts, and this system makes no claim about them.",
            },
            {
              title: "Multi-disease models",
              body: "Four bacteria have a model. Extending to other pathogens or to non-infectious conditions would need labelled data for each one, which is why every other condition is answered with documented evidence and no number.",
            },
            {
              title: "IP and regulatory route",
              body: "Whether a repurposing hypothesis could be protected, or pursued under a 505(b)(2) pathway, has not been assessed. Nothing here has been evaluated for novelty or for regulatory viability.",
            },
            {
              title: "Wet-lab validation",
              body: "No prediction on this site has been tested at the bench by this project. Until something is measured, every computational result stays on the computational rung.",
            },
            {
              title: "Prospective evaluation",
              body: "The case study is retrospective. A real test would fix a prediction in advance, then check it against evidence the models never saw — that experiment has not been run.",
            },
          ].map((item) => (
            <li key={item.title} className="list-none bg-raised p-5">
              <h3 className="m-0 font-display text-[15px] font-semibold text-ink">
                {item.title}
              </h3>
              <p className="m-0 mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What this site is">
        <LimitationCallout title="A research prototype, reporting its own limits">
          This is a screening and evidence-inspection tool over public data. It produces
          hypotheses to look into, with the kind of evidence behind each one stated
          plainly. It does not establish that any medicine treats any infection, and it is
          not medical advice.
        </LimitationCallout>
      </Section>
    </Page>
  );
}
