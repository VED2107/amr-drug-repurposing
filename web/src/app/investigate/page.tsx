import Link from "next/link";
import { redirect } from "next/navigation";

import {
  CandidateList,
  ComputationalBlock,
  DocumentedBlock,
  DoesNotEstablish,
  EvidenceIcon,
  SectionHead,
  StudyList,
  STUDY_NOTE,
} from "@/components/investigate";
import { StudiesToggle } from "@/components/investigate/StudiesToggle";
import { StudyTimeline } from "@/components/investigate/StudyTimeline";
import { Page } from "@/components/primitives";
import { OrganismCell } from "@/components/story/diagrams";
import { medicineName } from "@/lib/format";
import { getPathogens } from "@/lib/queries/core";
import { getRepurposingCandidates, getRepurposingSummary, type EvidenceFilter } from "@/lib/queries/repurposing";
import {
  conditionForPathogen,
  conditionTerms,
  documentedSet,
  getMedicinesWithLabRecords,
  getMedicinesWithStudies,
  getStudies,
  resolveMedicine,
  getStudyTimeline,
} from "@/lib/queries/investigate";
import { DISCOVERY_THRESHOLD_TEXT, matchModelledPathogen, NO_MODEL_NOTICE } from "@/lib/science";
import { isPathogenKey, type PathogenKey } from "@/lib/types";
import { firstValue, numberParam, type RawSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * `/investigate?medicine=…` resolves typed text to a medicine.
 * `/investigate?condition=…` is the condition investigation.
 */
export default async function InvestigatePage(props: { searchParams: Promise<RawSearchParams> }) {
  const params = await props.searchParams;
  const condition = (firstValue(params, "condition") ?? "").trim();
  const medicine = (firstValue(params, "medicine") ?? "").trim();

  const pathogen = firstValue(params, "pathogen");
  if (isPathogenKey(pathogen)) return <PathogenView pathogenKey={pathogen} params={params} />;
  if (condition) return <ConditionView condition={condition} params={params} />;
  if (medicine) return <MedicineResolution text={medicine} />;
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Medicine text                                                       */
/* ------------------------------------------------------------------ */

async function MedicineResolution({ text }: { text: string }) {
  const result = await resolveMedicine(text);
  if (result.kind === "found") redirect(`/investigate/${encodeURIComponent(result.moleculeId)}`);

  if (result.kind === "unscreened") {
    return (
      <Page>
        <h1 className="m-0 font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          {medicineName(result.name)}
        </h1>
        <div className="mt-6 max-w-[70ch] rounded-card border border-rule bg-raised p-4 md:p-6">
          <p className="m-0 flex items-center gap-2.5 font-display text-[16px] font-semibold text-ink">
            <EvidenceIcon kind="unchecked" />
            No AI prediction for this medicine
          </p>
          <p className="m-0 mt-2 text-[14px] leading-relaxed text-ink-2">
            It is in the approved-medicine list ({result.products.toLocaleString("en-GB")}{" "}
            {result.products === 1 ? "product" : "products"}), but no usable chemical structure could
            be matched to it, so the models could not screen it and no registry search was run for
            it. This is <strong>not yet checked</strong>, not a negative result.
          </p>
        </div>
        <div className="mt-10">
          <DoesNotEstablish />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <h1 className="m-0 font-display text-[clamp(26px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
        &ldquo;{text}&rdquo;
      </h1>
      {result.hits.length === 0 ? (
        <p className="m-0 mt-4 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
          No medicine in this dataset matches. The dataset holds FDA-approved medicines only, so
          this says nothing about the medicine itself.
        </p>
      ) : (
        <>
          <p className="m-0 mt-3 text-[14px] text-ink-2">
            {result.hits.length === 1 ? "One medicine matches." : `${result.hits.length} medicines match.`}{" "}
            Choose one to investigate.
          </p>
          <ul className="m-0 mt-5 grid max-w-[900px] list-none gap-px border border-rule bg-rule p-0 sm:grid-cols-2">
            {result.hits.map((hit) => (
              <li key={hit.href} className="bg-raised">
                <Link href={hit.href} className="flex min-h-[64px] flex-col justify-center gap-0.5 p-3.5 no-underline hover-row">
                  <span className="font-display text-[15px] font-semibold text-ink">{medicineName(hit.name)}</span>
                  <span className="font-mono text-[11px] text-muted">{hit.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Condition                                                           */
/* ------------------------------------------------------------------ */

async function ConditionView({ condition, params }: { condition: string; params: RawSearchParams }) {
  const pathogenKey = matchModelledPathogen(condition);
  const terms = conditionTerms(condition, pathogenKey);
  const path = "/investigate";

  const [pathogens, byStudies, byLab, candidates, allCandidates, studies, timeline] = await Promise.all([
    getPathogens(),
    getMedicinesWithStudies(terms),
    pathogenKey ? getMedicinesWithLabRecords(pathogenKey) : Promise.resolve([]),
    pathogenKey
      ? getRepurposingCandidates({
          pathogenKey,
          excludeWhere: documentedSet(terms, pathogenKey),
          page: numberParam(params, "cp") ?? 1,
        })
      : Promise.resolve(null),
    // The pathogen's whole candidate population: the figure its own page and
    // the dashboard show. The list on this page is that population minus the
    // candidates already documented for this condition.
    pathogenKey ? getRepurposingCandidates({ pathogenKey, pageSize: 1 }) : Promise.resolve(null),
    getStudies({ terms, page: numberParam(params, "sp") ?? 1 }),
    getStudyTimeline(terms),
  ]);

  const pathogen = pathogenKey ? pathogens.find((p) => p.key === pathogenKey) ?? null : null;
  const pathogenLabel = pathogen?.label ?? "";
  const n = (v: number) => v.toLocaleString("en-GB");
  // Repurposing candidates that already appear in a documented list above.
  const alreadyDocumented = candidates && allCandidates ? allCandidates.total - candidates.total : 0;

  return (
    <Page>
      <div className="flex items-center gap-5">
        {pathogen ? <OrganismCell pathogen={pathogen.key} size={72} /> : null}
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            {condition}
          </h1>
          {pathogen ? (
            <p className="m-0 mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-rule bg-raised py-1 pl-3 pr-3.5 text-[13px] text-ink-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Supported pathogen</span>
              <strong className="font-display font-semibold text-ink">{pathogen.label}</strong>
              <span className="italic text-muted">{pathogen.fullName}</span>
            </p>
          ) : null}
        </div>
      </div>

      {pathogen ? (
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          <a href="#documented" className="amr-jump inline-flex min-h-10 items-center gap-2 rounded-full border border-rule bg-raised px-3.5 text-[13px] text-ink-2 no-underline">
            <EvidenceIcon kind="clinical" size={10} />
            <span className="font-mono tabular-nums text-ink">{n(byStudies.length)}</span> with registered studies
          </a>
          <a href="#documented" className="amr-jump inline-flex min-h-10 items-center gap-2 rounded-full border border-rule bg-raised px-3.5 text-[13px] text-ink-2 no-underline">
            <EvidenceIcon kind="experimental" size={10} />
            <span className="font-mono tabular-nums text-ink">{n(byLab.length)}</span> with laboratory records
          </a>
          {allCandidates ? (
            <Link href={`/investigate?pathogen=${pathogenKey}`} className="amr-jump inline-flex min-h-10 items-center gap-2 rounded-full border border-rule bg-raised px-3.5 text-[13px] text-ink-2 no-underline">
              <EvidenceIcon kind="computational" size={10} />
              <span className="font-mono tabular-nums text-ink">{n(allCandidates.total)}</span> repurposing candidates, AI-predicted {DISCOVERY_THRESHOLD_TEXT}
            </Link>
          ) : null}
          {candidates ? (
            <a href="#candidates" className="amr-jump inline-flex min-h-10 items-center gap-2 rounded-full border border-computational bg-raised px-3.5 text-[13px] text-ink-2 no-underline">
              <EvidenceIcon kind="computational" size={10} />
              <span className="font-mono tabular-nums text-computational">{n(candidates.total)}</span> additional, not already listed above
            </a>
          ) : null}
        </nav>
      ) : (
        <div role="note" className="mt-5 max-w-[72ch] rounded-card border border-rule bg-raised p-4">
          <p className="m-0 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink">
            <span className="mt-1.5">
              <EvidenceIcon kind="unchecked" />
            </span>
            {NO_MODEL_NOTICE}
          </p>
          <p className="m-0 mt-1.5 pl-6 text-[13px] leading-relaxed text-ink-2">
            What follows is documented evidence only.
          </p>
        </div>
      )}

      <div className="mt-10 grid gap-6">
        <DocumentedBlock
          id="documented"
          title={pathogen ? "Medicines already documented" : "Medicines with registered studies"}
        >
          <p className="m-0 mb-3 text-[13px] leading-relaxed text-ink-2">
            Registered studies whose listed conditions mention{" "}
            {terms.map((t, i) => (
              <span key={t}>
                {i > 0 ? ", " : ""}
                <span className="font-mono text-[12px]">&ldquo;{t.trim()}&rdquo;</span>
              </span>
            ))}
            .
          </p>
          <MedicineLinks
            items={byStudies.map((m) => ({
              moleculeId: m.moleculeId,
              name: m.name,
              detail: `${n(m.studies)} registered ${m.studies === 1 ? "study" : "studies"}`,
            }))}
            empty="No medicine in this dataset has a registered study for this condition. That is no evidence found, not evidence of no effect."
          />

          {pathogen ? (
            <div className="mt-6">
              <p className="m-0 mb-3 text-[13px] leading-relaxed text-ink-2">
                <span className="mr-1.5 inline-block align-[-1px]">
                  <EvidenceIcon kind="experimental" size={11} />
                </span>
                Laboratory measurements against {pathogen.label} recorded in ChEMBL.
              </p>
              <MedicineLinks
                items={byLab.map((m) => ({
                  moleculeId: m.moleculeId,
                  name: m.name,
                  detail: `measured active in ${n(m.measuredActive)} of ${n(m.records)} lab ${m.records === 1 ? "record" : "records"}`,
                }))}
                empty={`No medicine in this dataset has a laboratory record against ${pathogen.label}.`}
              />
            </div>
          ) : null}
        </DocumentedBlock>

        {pathogen && candidates ? (
          <ComputationalBlock id="candidates" title="Other medicines to investigate">
            <p className="m-0 mb-4 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
              Approved medicines with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT} against{" "}
              {pathogenLabel} that are not already antibacterial medicines, have no registered
              study for this condition and have no laboratory record against it. Each shows what
              it is already used for. They were surfaced computationally for further
              investigation and are not presented as established treatments for this condition.
            </p>
            {allCandidates ? (
              <p className="amr-candidate-reconcile m-0 mb-4 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
                {pathogenLabel} has{" "}
                <span className="font-mono tabular-nums text-ink">{n(allCandidates.total)}</span> repurposing
                candidates in all.{" "}
                {alreadyDocumented > 0 ? (
                  <>
                    <span className="font-mono tabular-nums text-ink">{n(alreadyDocumented)}</span>{" "}
                    {alreadyDocumented === 1 ? "is" : "are"} already listed above, with a registered study for
                    this condition or a laboratory record, so the other{" "}
                    <span className="font-mono tabular-nums text-computational">{n(candidates.total)}</span>{" "}
                    are listed here.
                  </>
                ) : (
                  <>None of them is listed above, so all are listed here.</>
                )}
              </p>
            ) : null}
            <CandidateList
              data={candidates}
              pathogenLabel={pathogenLabel}
              path={path}
              params={params}
              anchor="candidates"
              pageParam="cp"
            />
            <p className="m-0 mt-4 text-[13px]">
              <Link href={`/investigate?pathogen=${pathogenKey}`}>
                Every repurposing candidate for {pathogenLabel}, including those with documented
                evidence →
              </Link>
            </p>
          </ComputationalBlock>
        ) : null}
      </div>

      <section id="studies" className="mt-12 scroll-mt-24">
        <SectionHead title="Registered studies" note={STUDY_NOTE} />
        {studies.total > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <StudiesToggle target="condition-studies" total={studies.total} />
          </div>
        ) : null}
        <div id="condition-studies">
          <StudyTimeline data={timeline} total={studies.total} />
          <StudyList
            data={studies}
            path={path}
            params={params}
            anchor="studies"
            pageParam="sp"
            empty="No registered study in this dataset lists this condition. That is no evidence found, not evidence of no effect."
          />
        </div>
      </section>

      <div className="mt-12">
        <DoesNotEstablish />
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Pathogen                                                            */
/* ------------------------------------------------------------------ */

const RANGES: { value: string; label: string; min: number; max: number }[] = [
  { value: "", label: "Any", min: 0, max: 1 },
  { value: "40-60", label: "40–60%", min: 0.4, max: 0.6 },
  { value: "60-80", label: "60–80%", min: 0.6, max: 0.8 },
  { value: "80-100", label: "80–100%", min: 0.8, max: 1 },
];

const EVIDENCE: { value: "" | EvidenceFilter; label: string }[] = [
  { value: "", label: "Any" },
  { value: "lab", label: "Lab records exist" },
  { value: "studies", label: "Registered studies exist" },
  { value: "none", label: "No documented evidence found" },
];

/**
 * `/investigate?pathogen=…`: every repurposing candidate for one pathogen,
 * searchable and paged. Its total is the dashboard's figure for this pathogen,
 * because both come from the same definition (`candidateFilter`).
 */
async function PathogenView({ pathogenKey, params }: { pathogenKey: PathogenKey; params: RawSearchParams }) {
  const name = (firstValue(params, "q") ?? "").trim();
  const use = (firstValue(params, "use") ?? "").trim();
  const range = RANGES.find((r) => r.value === (firstValue(params, "range") ?? "")) ?? RANGES[0];
  const evidence = EVIDENCE.find((e) => e.value === (firstValue(params, "evidence") ?? ""))?.value || undefined;
  const filtered = Boolean(name || use || range.value || evidence);

  const [pathogens, summary, list] = await Promise.all([
    getPathogens(),
    getRepurposingSummary(),
    getRepurposingCandidates({
      pathogenKey,
      name: name || undefined,
      use: use || undefined,
      min: range.value ? range.min : undefined,
      max: range.value ? range.max : undefined,
      evidence,
      page: numberParam(params, "page") ?? 1,
      pageSize: 24,
    }),
  ]);
  const pathogen = pathogens.find((p) => p.key === pathogenKey);
  const counts = summary.pathogens.find((p) => p.key === pathogenKey);
  const label = pathogen?.label ?? pathogenKey;
  const total = counts?.candidates ?? list.total;
  const n = (v: number) => v.toLocaleString("en-GB");
  const path = "/investigate";
  const conditionName = pathogenKey === "mtb" ? "tuberculosis" : `${label} infection`;

  return (
    <Page>
      <p className="m-0 text-[13px] text-muted">
        <Link href="/dashboard">Dashboard</Link> <span aria-hidden="true">/</span> {label}
      </p>
      <div className="mt-3 flex items-center gap-5">
        <OrganismCell pathogen={pathogenKey} size={72} />
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            Repurposing candidates for {label}
          </h1>
          {pathogen ? <p className="m-0 mt-2 text-[15px] italic text-muted">{pathogen.fullName}</p> : null}
        </div>
      </div>

      <p className="m-0 mt-5 max-w-[70ch] text-[15px] leading-relaxed text-ink-2">
        Approved medicines with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT} against {label}, leaving
        out medicines that are already antibacterials. Each is shown with what it is already used
        for. They are surfaced computationally for further investigation, not as treatments.
      </p>

      {counts ? (
        <dl className="m-0 mt-6 flex flex-wrap gap-2.5">
          <Count label={`AI-predicted activity ${DISCOVERY_THRESHOLD_TEXT}`} value={n(counts.withActivity)} />
          <Count label="Existing antibacterials set aside" value={n(counts.existingAntibacterials)} />
          <Count label="Needing review" value={n(counts.needsReview)} />
          <Count label="Repurposing candidates" value={n(counts.candidates)} accent />
        </dl>
      ) : null}

      <div className="mt-10">
        <ComputationalBlock id="list" title={`Repurposing candidates for ${label}`}>
          <form
            action={`${path}#list`}
            method="get"
            className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_auto] lg:items-end"
          >
            <input type="hidden" name="pathogen" value={pathogenKey} />
            <Field label="Medicine name">
              <input name="q" defaultValue={name} placeholder="Any medicine" className="amr-input min-h-11 w-full min-w-0 rounded-full border border-rule-strong bg-pure px-4 text-[13px] text-ink" />
            </Field>
            <Field label="Existing use">
              <input name="use" defaultValue={use} placeholder="e.g. depression" className="amr-input min-h-11 w-full min-w-0 rounded-full border border-rule-strong bg-pure px-4 text-[13px] text-ink" />
            </Field>
            <Field label="AI-predicted activity">
              <select name="range" defaultValue={range.value} className="amr-input min-h-11 w-full min-w-0 rounded-full border border-rule-strong bg-pure px-4 text-[13px] text-ink">
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence">
              <select name="evidence" defaultValue={evidence ?? ""} className="amr-input min-h-11 w-full min-w-0 rounded-full border border-rule-strong bg-pure px-4 text-[13px] text-ink">
                {EVIDENCE.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="amr-btn-quiet">
                Apply
              </button>
              {filtered ? (
                <Link href={`${path}?pathogen=${pathogenKey}#list`} className="amr-btn-quiet">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          <p className="m-0 mb-4 text-[13px] text-ink-2">
            {filtered
              ? `${n(list.total)} of ${n(total)} repurposing candidates match these filters.`
              : `All ${n(total)} repurposing candidates for ${label}.`}
          </p>

          <CandidateList
            data={list}
            pathogenLabel={label}
            path={path}
            params={params}
            anchor="list"
            pageParam="page"
            empty="No repurposing candidate matches these filters."
          />

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-rule-soft pt-4 text-[13px]">
            <a href={`/api/export/repurposing-candidates?pathogen=${pathogenKey}`} download>
              Download all {n(total)} candidates for {label} (CSV)
            </a>
            <Link href={`/investigate?condition=${encodeURIComponent(conditionForPathogen(pathogenKey))}`}>
              Documented evidence for {conditionName} →
            </Link>
          </div>
        </ComputationalBlock>
      </div>

      <div className="mt-12">
        <DoesNotEstablish />
      </div>
    </Page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Count({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-full border bg-raised px-4 py-2 ${accent ? "border-computational" : "border-rule"}`}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className="m-0 mt-0.5 font-mono text-[20px] font-medium tabular-nums leading-tight"
        style={{ color: accent ? "var(--color-computational)" : "var(--color-ink)" }}
      >
        {value}
      </dd>
    </div>
  );
}

function MedicineLinks({
  items,
  empty,
}: {
  items: { moleculeId: string; name: string; detail: string }[];
  empty: string;
}) {
  if (items.length === 0) return <p className="m-0 text-[13px] text-muted">{empty}</p>;
  const first = items.slice(0, SHOWN);
  const rest = items.slice(SHOWN);
  return (
    <>
      <LinkGrid items={first} />
      {rest.length ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-mono text-[12px] text-ink">
            Show all {items.length.toLocaleString("en-GB")}
          </summary>
          <LinkGrid items={rest} />
        </details>
      ) : null}
    </>
  );
}

/** How many documented medicines show before "Show all". */
const SHOWN = 18;

function LinkGrid({ items }: { items: { moleculeId: string; name: string; detail: string }[] }) {
  return (
    <ul className="m-0 grid list-none gap-x-6 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.moleculeId} className="border-b border-rule-soft">
          <Link
            href={`/investigate/${encodeURIComponent(item.moleculeId)}`}
            className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-3 py-2 no-underline hover-row"
          >
            <span className="font-display text-[14px] font-semibold text-ink">{medicineName(item.name)}</span>
            <span className="font-mono text-[11px] text-muted">{item.detail}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
