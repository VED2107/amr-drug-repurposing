import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumb, num } from "@/components/primitives";
import { PageTransition } from "@/components/motion/PageTransition";
import { getClinicalOverview } from "@/lib/queries/analysis";
import { getBuildInfo } from "@/lib/queries/build";
import { getCoverageSummary, getModelVersions, getPathogens, getPipelineRuns } from "@/lib/queries/core";
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
 * Dashboard: the state of the research system, read in one pass.
 *
 * Built from specimen cards. Each card carries a slim label strip naming the
 * kind of record inside it, marked with the glyph and colour of its evidence
 * state from the five-state language used across the site: library ● ink,
 * measured ■ experimental, registry ◆ clinical, computed ▲ computational. A
 * reader learns which figures are laboratory measurements and which are model
 * output before reading any number.
 *
 * The cards differ in size because their contents differ: a bento with one
 * cell per piece of content, never a row of equal tiles. Nothing inside a card
 * is another card; rows are ruled. Nothing here animates.
 *
 * Nothing is summarised into a single score and nothing is ranked. Every figure
 * is counted from the database at render time.
 */
export default async function DashboardPage() {
  const [coverage, clinical, pathogens, models, runs, build] = await Promise.all([
    getCoverageSummary(),
    getClinicalOverview(),
    getPathogens(),
    getModelVersions(true),
    getPipelineRuns(6),
    getBuildInfo(),
  ]);

  const notYetChecked = Math.max(0, coverage.clinicalTotal - coverage.clinicalChecked);
  const notYetDocked = Math.max(0, coverage.approvedMedicines - coverage.dockedMedicines);

  return (
    <PageTransition>
      <div className="mx-auto max-w-shell px-4 pb-16 pt-8 md:px-8 md:pt-12 lg:px-12">
        <Breadcrumb trail={["AMR Research", "Dashboard"]} />
        <h1 className="m-0 max-w-[20ch] font-display text-[clamp(30px,3.6vw,48px)] font-normal leading-[1.02] tracking-[-0.03em] text-ink [text-wrap:balance]">
          Current research state
        </h1>
        <p className="m-0 mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
          A live summary of what this research system holds, what it has checked so far, and
          what it cannot tell you. Every number is counted from the database when you open the
          page.
        </p>
        <p className="m-0 mt-2 font-mono text-[11px] text-muted">
          {coverage.activeModels} models in use, trained on dataset {build.datasetVersion ?? "unavailable"},
          last updated {build.snapshot ?? "unavailable"}
        </p>

        {/* ------------------------------------------------------------ */}
        {/* The counts: one card per kind of record                       */}
        {/* ------------------------------------------------------------ */}
        <h2 className="sr-only">Live counts</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-12">
          <Specimen kind="library" className="md:col-span-2 lg:col-span-5 lg:row-span-2">
            <div className="flex h-full flex-col justify-between gap-10 p-6 md:p-8">
              <Figure
                value={coverage.approvedMedicines}
                label="Approved medicines being screened"
                term="approved medicines with a valid structure"
                size="lead"
              />
              <div className="border-t border-rule-soft pt-5">
                <Figure
                  value={coverage.validStructures}
                  label="Chemical structures on file"
                  note="Includes the compounds from lab data, not only medicines."
                  term="valid molecular structures"
                />
              </div>
            </div>
          </Specimen>

          <Specimen kind="measured" className="lg:col-span-3">
            <div className="p-6">
              <Figure
                value={coverage.labelledBioactivity}
                label="Lab test results against the four bacteria"
                note="Each records whether a compound was active or inactive in a real test."
                term="labelled bioactivity records"
              />
            </div>
          </Specimen>

          <Specimen kind="registry" className="lg:col-span-4">
            <div className="p-6">
              <Figure
                value={coverage.distinctStudies}
                label="Clinical studies registered for these medicines"
                note="A registration says a study exists. It is not a result."
                term={`distinct studies, ${num(coverage.trialLinks)} medicine links`}
              />
            </div>
          </Specimen>

          <Specimen kind="computed" className="md:col-span-2 lg:col-span-7">
            <div className="grid gap-px bg-rule-soft sm:grid-cols-2">
              <div className="bg-raised p-6">
                <Figure
                  value={coverage.activePredictions}
                  label="AI activity predictions"
                  note="Four models, one per bacterium, applied to every medicine. Not a treatment claim."
                  term="predictions from ACTIVE models"
                />
              </div>
              <div className="bg-raised p-6">
                <Figure
                  value={coverage.storedPoses}
                  label="3D docking simulations"
                  note={`A computer model of a medicine fitting a bacterial protein, for ${num(coverage.dockedMedicines)} medicines so far.`}
                  term="stored docking poses"
                />
              </div>
            </div>
          </Specimen>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Coverage and models                                           */}
        {/* ------------------------------------------------------------ */}
        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          <Card title="Coverage" className="lg:col-span-7">
            <CoverageRow
              title="Clinical evidence"
              note="Searched on ClinicalTrials.gov"
              done={coverage.clinicalChecked}
              total={coverage.clinicalTotal}
              segments={[
                { value: clinical.medicinesWithStudies, rung: "clinical", label: "returned studies" },
                { value: clinical.medicinesWithNoResults, rung: "none", label: "no evidence found" },
              ]}
              remainder={{ value: notYetChecked, label: "not yet checked" }}
              href="/clinical"
            />
            <CoverageRow
              title="Docking"
              note="Only a first set has been simulated"
              done={coverage.dockedMedicines}
              total={coverage.approvedMedicines}
              segments={[{ value: coverage.dockedMedicines, rung: "computational", label: "docked" }]}
              remainder={{ value: notYetDocked, label: "not yet docked" }}
              href="/docking"
            />
            <p className="m-0 px-6 pb-6 pt-4 text-[13px] leading-relaxed text-ink-2">
              <strong>Not yet checked</strong> is different from <strong>no evidence found</strong>, and
              neither means the medicine has <strong>no effect</strong>. A medicine that has not been
              docked simply has no simulation yet. {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol
              is the score this project uses to flag a strong fit; it is not a universal standard.
            </p>
          </Card>

          <Card title="The four bacteria we model" action={{ href: "/models", label: "Models" }} className="lg:col-span-5">
            <ul className="m-0 list-none p-0">
              {pathogens.map((p) => {
                const model = models.find((m) => m.pathogenKey === p.key) ?? null;
                return (
                  <li key={p.key} className="border-b border-rule-soft px-6 py-4 last:border-b-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                        {p.label}
                      </span>
                      <span className="font-mono text-[11px] text-ink">{model?.modelVersion ?? "no ACTIVE model"}</span>
                    </div>
                    <p className="m-0 mt-0.5 text-[12px] italic text-muted">{p.fullName}</p>
                    <p className="m-0 mt-2 font-mono text-[10px] text-ink-2">
                      {num(p.labelledRecords)} lab results,{" "}
                      {p.resistantStrainFraction === null
                        ? "none labelled by strain"
                        : `${(p.resistantStrainFraction * 100).toFixed(1)}% from resistant strains`}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 border-t border-rule-soft px-6 py-4 text-[13px] text-ink-2">
              Only these four can show an AI-predicted activity. For any other disease the site shows
              documented evidence only.
            </p>
          </Card>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Provenance and limits                                         */}
        {/* ------------------------------------------------------------ */}
        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          <Card
            title="What the system did recently"
            action={{ href: "/runs", label: "Run history" }}
            className="lg:col-span-7"
          >
            {runs.length === 0 ? (
              <p className="m-0 p-6 text-[13px] text-muted">No runs recorded in this database.</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {runs.map((r) => (
                  <li
                    key={r.runId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 border-b border-rule-soft px-6 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
                  >
                    <span className="col-span-2 font-mono text-[11px] tabular-nums text-muted sm:col-span-1">
                      {r.startedAt.slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="min-w-0 text-[14px] text-ink">
                      <span className="font-display">{STAGE_NOTE[r.stage] ?? r.stage}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted">{r.stage}</span>
                    </span>
                    <span className="text-right font-mono text-[11px] tabular-nums text-ink-2">
                      {r.status !== "SUCCESS" ? (
                        <span className="mr-2 text-rose">{r.status.toLowerCase()}</span>
                      ) : null}
                      {num(r.recordsNew)} new records
                      {r.errorCount > 0 ? <span className="ml-2 text-rose">{num(r.errorCount)} errors</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="m-0 px-6 py-4 text-[13px] leading-relaxed text-ink-2">
              When a medicine is newly approved, the system finds it and scores it with the four
              models already in use. It is never used to retrain them.{" "}
              <Link href="/pipeline#new-medicines">How a new medicine is scored</Link>
            </p>
          </Card>

          <section
            aria-labelledby="limits-heading"
            className="rounded-card border border-rule bg-sunken p-6 lg:col-span-5"
          >
            <h2
              id="limits-heading"
              className="m-0 font-display text-[18px] font-normal tracking-[-0.015em] text-ink"
            >
              What this site cannot tell you
            </h2>
            <ul className="m-0 mt-4 list-none space-y-4 p-0">
              {[
                RESISTANCE_LIMITATION,
                "A registered study is not a successful study, and FDA approval for one disease is not approval for another.",
                "A prediction or a docking score does not show that a medicine treats a disease.",
              ].map((text) => (
                <li key={text} className="border-t border-rule pt-4 text-[13px] leading-relaxed text-ink-2">
                  {text}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Where to go next                                              */}
        {/* ------------------------------------------------------------ */}
        <section aria-labelledby="investigate-heading" className="mt-16">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="investigate-heading"
              className="m-0 font-display text-[clamp(20px,1.8vw,24px)] font-normal tracking-[-0.02em] text-ink"
            >
              Open an investigation
            </h2>
            <p className="m-0 text-[12px] text-muted">No ranking and no recommendation.</p>
          </div>
          <ul className="m-0 grid list-none gap-px overflow-hidden rounded-card border border-rule bg-rule p-0 sm:grid-cols-2 lg:grid-cols-5">
            {INVESTIGATIONS.map((item) => (
              <li key={item.href} className="min-w-0 bg-raised">
                <Link
                  href={item.href}
                  className="group flex h-full min-h-11 flex-col px-5 py-4 no-underline transition-colors duration-150 hover:bg-paper"
                >
                  <span className="font-display text-[14px] text-ink">
                    {item.label}{" "}
                    <span
                      aria-hidden="true"
                      className="inline-block text-accent transition-transform duration-150 group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </span>
                  <span
                    className="mt-1.5 text-[12px] leading-snug"
                    style={{ color: item.future ? "var(--color-rose)" : "var(--color-ink-2)" }}
                  >
                    {item.note}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageTransition>
  );
}

/** What each recorded stage did, in the pipeline's own terms. */
const STAGE_NOTE: Record<string, string> = {
  ingest: "Collected data from public sources",
  process: "Cleaned and checked chemical structures",
  train: "Trained candidate models",
  predict: "Scored every medicine",
  dock: "Ran 3D docking simulations",
  clinical: "Searched the trial registry",
  update: "Checked for newly approved medicines",
};

const INVESTIGATIONS: { href: string; label: string; note: string; future?: boolean }[] = [
  { href: "/candidates", label: "Candidate Explorer", note: "One medicine's predictions for all four bacteria." },
  { href: "/explorer", label: "Medicine × Condition", note: "What evidence exists for a medicine and a condition." },
  { href: "/docking", label: "Docking & 3D", note: "How a medicine might fit a bacterial protein." },
  { href: "/case-study", label: "Case Study", note: "A worked example of why a high score can mislead." },
  { href: "/roadmap", label: "Roadmap", note: "Not built. Future work only.", future: true },
];

/* ------------------------------------------------------------------------ */
/* Specimen cards                                                           */
/* ------------------------------------------------------------------------ */

/** The kinds of record, in the evidence language used across the site. */
const KINDS = {
  library: { label: "Library", sub: "what is being screened", glyph: "●", color: "var(--color-ink)" },
  measured: { label: "Measured", sub: "from real lab tests", glyph: "■", color: "var(--color-experimental)" },
  registry: { label: "Registry", sub: "studies in people", glyph: "◆", color: "var(--color-clinical)" },
  computed: { label: "Computed", sub: "made by computer models", glyph: "▲", color: "var(--color-computational)" },
} as const;

/**
 * A specimen card: the label strip names the kind of record, the body holds the
 * figures. The strip's glyph and colour are the evidence state, not decoration.
 */
function Specimen({
  kind,
  className = "",
  children,
}: {
  kind: keyof typeof KINDS;
  className?: string;
  children: ReactNode;
}) {
  const k = KINDS[kind];
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-card border border-rule bg-raised ${className}`}>
      <h3 className="m-0 flex items-baseline justify-between gap-3 border-b border-rule-soft bg-paper px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[0.16em]">
        <span style={{ color: k.color }}>
          <span aria-hidden="true">{k.glyph} </span>
          {k.label}
        </span>
        <span className="normal-case tracking-normal text-muted">{k.sub}</span>
      </h3>
      <div className="flex-1">{children}</div>
    </section>
  );
}

/** A working card: a plain title strip, ruled rows inside, one optional link. */
function Card({
  title,
  action,
  className = "",
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-card border border-rule bg-raised ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-rule-soft px-6 py-2">
        <h2 className="m-0 py-2 font-display text-[18px] font-normal tracking-[-0.015em] text-ink">{title}</h2>
        {action ? (
          <Link href={action.href} className="inline-flex min-h-11 items-center text-[13px]">
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Figure({
  value,
  label,
  note,
  term,
  size = "standard",
}: {
  value: number;
  /** What the number is, in words a clinician would use. */
  label: string;
  /** One plain sentence on what it means or does not mean. */
  note?: string;
  /** The database term, for readers who want it. */
  term?: string;
  size?: "lead" | "standard";
}) {
  const lead = size === "lead";
  return (
    <div className="min-w-0">
      <p
        className={`m-0 font-display font-normal leading-none tracking-[-0.035em] tabular-nums text-ink ${
          lead ? "text-[clamp(56px,6.4vw,96px)]" : "text-[clamp(28px,2.6vw,38px)]"
        }`}
      >
        {num(value)}
      </p>
      <p className={`m-0 text-ink-2 ${lead ? "mt-4 text-[15px]" : "mt-2.5 text-[13px]"}`}>{label}</p>
      {note ? <p className="m-0 mt-1.5 max-w-[44ch] text-[12px] leading-snug text-muted">{note}</p> : null}
      {term ? <p className="m-0 mt-2 font-mono text-[10px] text-faint">{term}</p> : null}
    </div>
  );
}

type Rung = "clinical" | "none" | "computational";

const RUNG_STYLE: Record<Rung, { color: string; glyph: string }> = {
  clinical: { color: "var(--color-clinical)", glyph: "◆" },
  none: { color: "var(--color-none)", glyph: "○" },
  computational: { color: "var(--color-computational)", glyph: "▲" },
};

function CoverageRow({
  title,
  note,
  done,
  total,
  segments,
  remainder,
  href,
}: {
  title: string;
  note: string;
  done: number;
  total: number;
  segments: { value: number; rung: Rung; label: string }[];
  remainder: { value: number; label: string };
  href: string;
}) {
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const description = [
    ...segments.map((s) => `${num(s.value)} ${s.label}`),
    `${num(remainder.value)} ${remainder.label}`,
  ].join("; ");

  return (
    <div className="grid gap-x-8 gap-y-4 border-b border-rule-soft px-6 py-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <Link
          href={href}
          className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline hover:underline"
        >
          {title}
        </Link>
        <p className="m-0 mt-2 font-display whitespace-nowrap text-[clamp(26px,2.4vw,34px)] leading-none tracking-[-0.03em] tabular-nums text-ink">
          {num(done)}
          <span className="text-faint"> / {num(total)}</span>
        </p>
        <p className="m-0 mt-2 text-[12px] text-muted">{note}</p>
      </div>

      <div className="min-w-0 self-center">
        <div role="img" aria-label={`${title}, of ${num(total)}: ${description}`} className="flex h-2 bg-sunken">
          {segments.map((s) =>
            s.value > 0 ? (
              <div key={s.label} style={{ width: `${share(s.value)}%`, background: RUNG_STYLE[s.rung].color }} />
            ) : null,
          )}
        </div>
        <dl className="m-0 mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]">
          {segments.map((s) => (
            <div key={s.label} className="flex gap-2">
              <dt style={{ color: RUNG_STYLE[s.rung].color }}>
                <span aria-hidden="true">{RUNG_STYLE[s.rung].glyph} </span>
                {s.label}
              </dt>
              <dd className="m-0 tabular-nums text-ink">{num(s.value)}</dd>
            </div>
          ))}
          <div className="flex gap-2">
            <dt className="text-unchecked">
              <span aria-hidden="true">- </span>
              {remainder.label}
            </dt>
            <dd className="m-0 tabular-nums text-ink">{num(remainder.value)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
