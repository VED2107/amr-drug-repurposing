import Link from "next/link";
import { redirect } from "next/navigation";

import {
  CandidateList,
  ComputationalBlock,
  DocumentedBlock,
  DoesNotEstablish,
  SectionHead,
  StudyList,
  STUDY_NOTE,
} from "@/components/investigate";
import { Page } from "@/components/primitives";
import { medicineName } from "@/lib/format";
import { getPathogens } from "@/lib/queries/core";
import {
  conditionTerms,
  documentedSet,
  getCandidates,
  getMedicinesWithLabRecords,
  getMedicinesWithStudies,
  getStudies,
  resolveMedicine,
} from "@/lib/queries/investigate";
import { DISCOVERY_THRESHOLD_TEXT, matchModelledPathogen, NO_MODEL_NOTICE } from "@/lib/science";
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
        <Kicker>Medicine</Kicker>
        <h1 className="m-0 font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          {medicineName(result.name)}
        </h1>
        <div className="mt-6 max-w-[70ch] border border-rule bg-raised p-4 md:p-6" style={{ borderLeft: "3px solid var(--color-unchecked)" }}>
          <p className="m-0 font-display text-[16px] font-semibold text-ink">
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
      <Kicker>Medicine search</Kicker>
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

  const [pathogens, byStudies, byLab, candidates, studies] = await Promise.all([
    getPathogens(),
    getMedicinesWithStudies(terms),
    pathogenKey ? getMedicinesWithLabRecords(pathogenKey) : Promise.resolve([]),
    pathogenKey
      ? getCandidates({
          pathogenKey,
          excludeWhere: documentedSet(terms, pathogenKey),
          page: numberParam(params, "cp") ?? 1,
        })
      : Promise.resolve(null),
    getStudies({ terms, page: numberParam(params, "sp") ?? 1 }),
  ]);

  const pathogen = pathogenKey ? pathogens.find((p) => p.key === pathogenKey) ?? null : null;
  const pathogenLabel = pathogen?.label ?? "";
  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <Page>
      <Kicker>Condition</Kicker>
      <h1 className="m-0 font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
        {condition}
      </h1>

      {pathogen ? (
        <p className="m-0 mt-4 text-[15px] text-ink-2">
          Supported pathogen:{" "}
          <strong className="font-display font-semibold text-ink">{pathogen.label}</strong>{" "}
          <span className="italic text-muted">({pathogen.fullName})</span>
        </p>
      ) : (
        <div
          role="note"
          className="mt-5 max-w-[72ch] border border-rule bg-raised p-4"
          style={{ borderLeft: "3px solid var(--color-unchecked)" }}
        >
          <p className="m-0 text-[14px] leading-relaxed text-ink">{NO_MODEL_NOTICE}</p>
          <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-2">
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
                <span aria-hidden="true" className="text-experimental">■ </span>
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
              Medicines with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT} against{" "}
              {pathogenLabel} that have no registered study for this condition and no laboratory
              record against it. These medicines were surfaced computationally and are not
              presented as established treatments for this condition.
            </p>
            <CandidateList
              data={candidates}
              pathogenLabel={pathogenLabel}
              path={path}
              params={params}
              anchor="candidates"
              pageParam="cp"
            />
          </ComputationalBlock>
        ) : null}
      </div>

      <section id="studies" className="mt-12 scroll-mt-24">
        <SectionHead title="Registered studies" note={STUDY_NOTE} />
        <StudyList
          data={studies}
          path={path}
          params={params}
          anchor="studies"
          pageParam="sp"
          empty="No registered study in this dataset lists this condition. That is no evidence found, not evidence of no effect."
        />
      </section>

      <div className="mt-12">
        <DoesNotEstablish />
      </div>
    </Page>
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

function Kicker({ children }: { children: string }) {
  return (
    <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{children}</p>
  );
}
