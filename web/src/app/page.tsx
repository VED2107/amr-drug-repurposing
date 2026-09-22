import Link from "next/link";

import { PageTransition } from "@/components/motion";
import { getCoverageSummary, getPathogens } from "@/lib/queries/core";
import { num } from "@/components/primitives";
import { RESISTANCE_LIMITATION } from "@/lib/science";
import { CRISIS_CONTEXT, REPURPOSING_PRECEDENT, WHY_THESE_FOUR, STAGES } from "@/lib/content";

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
 * Overview.
 *
 * Editorial density: this is the surface that has to explain what the system
 * is to someone who is not a cheminformatician, and persuade them the numbers
 * downstream are worth reading. It shares every token with the Dashboard —
 * same type, same rules, same colours — and differs only in how much air it
 * gives each idea.
 *
 * The hero deliberately carries no result figure. "N candidates found" would
 * be the exact failure this system exists to avoid.
 */
export default async function OverviewPage() {
  const [coverage, pathogens] = await Promise.all([getCoverageSummary(), getPathogens()]);

  const dockedPercent =
    coverage.approvedMedicines > 0
      ? (coverage.dockedMedicines / coverage.approvedMedicines) * 100
      : null;
  const notDocked = coverage.approvedMedicines - coverage.dockedMedicines;

  return (
    <PageTransition>
    <div>
      {/* ---------------------------------------------------------- */}
      {/* Hero                                                        */}
      {/* ---------------------------------------------------------- */}
      <section className="mx-auto max-w-shell px-4 pb-10 pt-14 md:px-8 md:pb-16 md:pt-24 lg:px-12 lg:pb-20 lg:pt-32">
        <div className="grid items-end gap-8 lg:grid-cols-3 lg:gap-16">
          <div className="amr-rise min-w-0 lg:col-span-2">
            <p className="m-0 mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted md:mb-8">
              AI-driven drug repurposing · research prototype
            </p>
            <h1 className="m-0 text-balance font-display text-[clamp(38px,7.4vw,104px)] font-normal leading-[0.95] tracking-[-0.035em] text-ink">
              Find signals in the medicines we already have.
            </h1>
          </div>
          <div className="amr-parallax min-w-0 max-w-[44ch]">
            <p className="m-0 mb-6 text-[clamp(15px,1.15vw,17px)] leading-[1.65] text-ink-2">
              An evidence-driven framework for exploring existing medicines against
              antimicrobial resistance — combining machine learning, molecular analysis,
              docking and clinical evidence.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/explorer"
                className="inline-flex min-h-12 items-center rounded-card bg-ink px-5 font-display text-[14px] text-paper no-underline transition-colors hover:bg-link"
              >
                Explore the evidence
              </Link>
              <Link
                href="/pipeline"
                className="inline-flex min-h-12 items-center rounded-card border border-rule-strong px-5 font-display text-[14px] text-ink no-underline transition-colors hover:border-ink"
              >
                How it works
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Docking coverage — a gap stated plainly, not hidden          */}
      {/* ---------------------------------------------------------- */}
      <section
        aria-label="Docking coverage"
        className="border-y border-rule bg-raised"
      >
        <div className="mx-auto flex max-w-shell flex-wrap items-end gap-5 px-4 py-5 md:gap-10 md:px-8 md:py-8 lg:px-12">
          <div>
            <p className="m-0 font-display text-[clamp(28px,4vw,46px)] leading-none tracking-[-0.03em] text-ink">
              {num(coverage.dockedMedicines)}
              <span className="text-fainter"> / {num(coverage.approvedMedicines)}</span>
            </p>
            <p className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              Medicines docked
              {dockedPercent !== null ? ` · ${dockedPercent.toFixed(1)}% of the scored library` : null}
            </p>
          </div>
          <div className="min-w-0 flex-1 basis-[260px]">
            <div
              role="img"
              aria-label={`${coverage.dockedMedicines} of ${coverage.approvedMedicines} medicines have been docked; ${notDocked} are not yet docked`}
              className="flex h-[34px] items-stretch border border-rule bg-paper"
            >
              <div
                style={{
                  width: `${dockedPercent ?? 0}%`,
                  background: "var(--color-violet)",
                }}
              />
              <div
                className="flex-1"
                style={{
                  background:
                    "repeating-linear-gradient(90deg,#E6E1D6 0 1px,transparent 1px 7px)",
                }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
              <span>docked</span>
              <span>not yet docked · {num(notDocked)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* The problem                                                 */}
      {/* ---------------------------------------------------------- */}
      <section className="mx-auto max-w-shell px-4 py-16 md:px-8 md:py-24 lg:px-12 lg:py-32">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-18">
          <div className="min-w-0">
            <p className="m-0 mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              02 — The problem
            </p>
            <h2 className="amr-rise m-0 max-w-[24ch] font-display text-[clamp(28px,3.6vw,54px)] font-normal leading-[1.04] tracking-[-0.03em] text-ink">
              Resistance outpaces the discovery of new antibiotics.
            </h2>
          </div>
          <div className="flex min-w-0 max-w-[60ch] flex-col gap-5">
            <p className="m-0 text-[clamp(15px,1.1vw,17px)] leading-[1.7] text-ink-2">
              Bringing a new antibacterial through development takes more than a decade.
              Resistance moves faster. Repurposing asks a narrower question with a shorter
              path: among medicines already approved for human use, whose safety and
              pharmacology are documented, are there molecules whose chemistry resembles
              what works against a resistant pathogen?
            </p>
            <p className="m-0 text-[clamp(15px,1.1vw,17px)] leading-[1.7] text-ink-2">
              This system screens {num(coverage.approvedMedicines)} approved medicines
              against four bacteria, then keeps every stage of the reasoning visible —
              including the parts that do not hold.
            </p>
            <p
              className="m-0 bg-raised px-4.5 py-4 text-[14px] leading-[1.6] text-ink-2"
              style={{ borderLeft: "2px solid var(--color-accent)" }}
            >
              This is a research prototype. Nothing here is medical advice, a treatment
              recommendation, or evidence of clinical effectiveness.
            </p>
          </div>
        </div>

        {/*
          Published context, kept visibly apart from everything this system
          counts. These four figures come from the project's own presentation
          and the literature behind it; nothing on this site measures them, and
          no result downstream is derived from them.
        */}
        <div className="mt-14 border-t border-rule pt-8 md:mt-20">
          <p className="m-0 mb-6 font-mono text-[10px] uppercase tracking-[0.16em] text-fainter">
            Published context · not produced or verified by this system
          </p>
          <dl className="m-0 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {CRISIS_CONTEXT.map((item) => (
              <div key={item.figure} className="border-t border-rule-strong pt-3">
                <dt className="m-0 font-mono text-[clamp(22px,2.6vw,34px)] font-medium tabular-nums leading-none text-ink">
                  {item.figure}
                </dt>
                <dd className="m-0 mt-2.5 max-w-[34ch] text-[13px] leading-snug text-ink-2">
                  {item.meaning}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
            <p className="m-0 max-w-[40ch] text-[14px] leading-[1.7] text-ink-2">
              Repurposing is not a new idea — the precedents below were found by
              observation, not by a computational screen. They are why the question is
              worth asking, not evidence about anything in this library.
            </p>
            <ul className="m-0 grid list-none gap-px border border-rule bg-rule p-0 sm:grid-cols-3">
              {REPURPOSING_PRECEDENT.map((item) => (
                <li key={item.medicine} className="bg-raised p-4">
                  <p className="m-0 font-display text-[15px] font-semibold text-ink">
                    {item.medicine}
                  </p>
                  <p className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    From
                  </p>
                  <p className="m-0 text-[12px] leading-snug text-ink-2">{item.from}</p>
                  <p className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    To
                  </p>
                  <p className="m-0 text-[12px] leading-snug text-ink-2">{item.to}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* The question                                                */}
      {/* ---------------------------------------------------------- */}
      <section className="border-t border-rule bg-ink text-paper">
        <div className="mx-auto max-w-shell px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-40">
          <p className="m-0 mb-6 font-mono text-[11px] uppercase tracking-[0.18em] text-faint md:mb-11">
            03 — The question
          </p>
          <p className="amr-rise m-0 max-w-[30ch] text-pretty font-display text-[clamp(26px,4.4vw,64px)] font-light leading-[1.12] tracking-[-0.03em]">
            What if some medicines we already understand could reveal new signals against
            resistant pathogens?
          </p>
          <p className="m-0 mt-6 max-w-[52ch] text-[14px] leading-[1.7] md:mt-11" style={{ color: "#B8B2A4" }}>
            A signal is a hypothesis to test, not a finding. Every number in this system is
            evidence of a computation, and the interface says which kind.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Five stages                                                 */}
      {/* ---------------------------------------------------------- */}
      <section className="mx-auto max-w-shell px-4 py-16 md:px-8 md:py-24 lg:px-12 lg:py-32">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-6 md:mb-14">
          <h2 className="m-0 font-display text-[clamp(28px,3.4vw,48px)] font-normal leading-[1.05] tracking-[-0.03em] text-ink">
            Five stages, each with its own limit.
          </h2>
          <Link href="/pipeline" className="font-display text-[14px]">
            Pipeline detail
          </Link>
        </div>

        <ol className="amr-stagger m-0 grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-2 xl:grid-cols-5">
          {STAGES.map((stage) => (
            <li key={stage.n} className="amr-rise bg-raised p-5 md:p-6">
              <p
                className="m-0 font-mono text-[11px] tracking-[0.14em]"
                style={{ color: stage.color }}
              >
                {stage.n}
              </p>
              <h3 className="m-0 mt-3 font-display text-[16px] font-semibold tracking-[0.02em] text-ink">
                {stage.name}
              </h3>
              <p className="m-0 mt-3 text-[13px] leading-relaxed text-ink-2">{stage.what}</p>
              <p className="m-0 mt-4 border-t border-rule-soft pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                Proves
              </p>
              <p className="m-0 mt-1 text-[12px] leading-relaxed text-ink-2">{stage.proves}</p>
              <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                Does not prove
              </p>
              <p className="m-0 mt-1 text-[12px] leading-relaxed text-muted">{stage.denies}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Four bacteria                                               */}
      {/* ---------------------------------------------------------- */}
      <section className="border-t border-rule bg-raised">
        <div className="mx-auto max-w-shell px-4 py-16 md:px-8 md:py-24 lg:px-12">
          <div className="mb-8 max-w-[60ch] md:mb-12">
            <p className="m-0 mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              04 — What is modelled
            </p>
            <h2 className="m-0 font-display text-[clamp(28px,3.4vw,48px)] font-normal leading-[1.05] tracking-[-0.03em] text-ink">
              Four bacteria have a model. Nothing else does.
            </h2>
            <p className="m-0 mt-4 text-[15px] leading-relaxed text-ink-2">
              A probability appears only for these four. For any other condition the
              interface shows documented evidence and states that no model exists — there
              is no fallback number.
            </p>
          </div>

          <div className="amr-stagger grid gap-px border border-rule bg-rule md:grid-cols-2 xl:grid-cols-4">
            {pathogens.map((p) => (
              <article key={p.key} className="amr-rise bg-paper p-5 md:p-6">
                <h3 className="m-0 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
                  {p.label}
                </h3>
                <p className="m-0 mt-1 font-mono text-[11px] italic text-muted">{p.fullName}</p>
                <dl className="m-0 mt-5 grid grid-cols-[1fr_auto] gap-y-2 border-t border-rule-soft pt-3">
                  <dt className="text-[12px] text-ink-2">Labelled records</dt>
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">
                    {num(p.labelledRecords)}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Resistant-strain records</dt>
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">
                    {num(p.resistantStrainRecords)}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Coverage</dt>
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">
                    {p.resistantStrainFraction === null
                      ? "—"
                      : `${(p.resistantStrainFraction * 100).toFixed(1)}%`}
                  </dd>
                  <dt className="text-[12px] text-ink-2">Active model</dt>
                  <dd className="m-0 font-mono text-[12px] text-ink">
                    {p.activeModelVersion ?? "none"}
                  </dd>
                </dl>
              </article>
            ))}
          </div>

          {/*
            The design rationale, which is otherwise invisible: these four are
            not an arbitrary set. Between them they cover the three structural
            classes of bacterial envelope, which is the reason a method that
            works across them is worth testing further. The mechanisms named
            here are what makes each organism resistant — not what the docking
            receptors are. Docking & 3D keeps those apart.
          */}
          <div className="mt-10">
            <p className="m-0 mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-fainter">
              Why these four · three structural classes
            </p>
            <div className="grid gap-px border border-rule bg-rule md:grid-cols-3">
              {WHY_THESE_FOUR.map((row) => (
                <article key={row.group} className="bg-paper p-5">
                  <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                    {row.group}
                  </p>
                  <p className="m-0 mt-1.5 font-display text-[15px] font-semibold text-ink">
                    {row.organisms}
                  </p>
                  <p className="m-0 mt-2.5 max-w-[44ch] text-[12px] leading-relaxed text-ink-2">
                    {row.envelope}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <p
            className="m-0 mt-8 max-w-[70ch] bg-paper px-4 py-4 text-[13px] leading-relaxed text-ink-2"
            style={{ borderLeft: "2px solid var(--color-none)" }}
          >
            {RESISTANCE_LIMITATION}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Live counts                                                 */}
      {/* ---------------------------------------------------------- */}
      <section className="mx-auto max-w-shell px-4 py-16 md:px-8 md:py-24 lg:px-12">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 font-display text-[clamp(24px,2.4vw,34px)] font-normal tracking-[-0.02em] text-ink">
            What is in the database right now
          </h2>
          <p className="m-0 font-mono text-[11px] text-muted">
            counted at render time
          </p>
        </div>

        <div className="amr-stagger grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-3">
          <Count value={num(coverage.approvedMedicines)} label="Approved medicines with a structure" source="COUNT(DISTINCT molecule_id) in drugs" />
          <Count value={num(coverage.validStructures)} label="Valid molecular structures" source="molecules WHERE is_valid" />
          <Count value={num(coverage.distinctStudies)} label="Distinct registered studies" source={`clinical_trials · ${num(coverage.trialLinks)} links`} />
          <Count value={num(coverage.storedPoses)} label="Stored docking poses" source="docking_results WHERE status = 'ok'" />
          <Count value={num(coverage.labelledBioactivity)} label="Labelled bioactivity records" source="bioactivity WHERE label IS NOT NULL" />
          <Count value={num(coverage.activePredictions)} label="Predictions from ACTIVE models" source={`${coverage.activeModels} ACTIVE model versions`} />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex min-h-12 items-center rounded-card bg-ink px-5 font-display text-[14px] text-paper no-underline transition-colors hover:bg-link"
          >
            Open the dashboard
          </Link>
          <Link
            href="/case-study"
            className="inline-flex min-h-12 items-center rounded-card border border-rule-strong px-5 font-display text-[14px] text-ink no-underline transition-colors hover:border-ink"
          >
            Read the case study
          </Link>
          <Link
            href="/roadmap"
            className="inline-flex min-h-12 items-center rounded-card border border-rule-strong px-5 font-display text-[14px] text-ink no-underline transition-colors hover:border-ink"
          >
            What is not built yet
          </Link>
        </div>
      </section>
    </div>
    </PageTransition>
  );
}

function Count({ value, label, source }: { value: string; label: string; source: string }) {
  return (
    <div className="amr-rise bg-raised p-5 md:p-6">
      <p className="m-0 font-mono text-[clamp(22px,2.4vw,32px)] font-medium tabular-nums leading-none text-ink">
        {value}
      </p>
      <p className="m-0 mt-3 text-[13px] leading-snug text-ink-2">{label}</p>
      <p className="m-0 mt-2 font-mono text-[10px] leading-snug text-fainter">{source}</p>
    </div>
  );
}
