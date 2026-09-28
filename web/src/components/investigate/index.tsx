import Link from "next/link";
import type { ReactNode } from "react";

import { Pagination } from "@/components/data";
import { formatPhase, formatStatus, medicineName, splitConditions } from "@/lib/format";
import type { CandidatePage, Study, StudyPage } from "@/lib/queries/investigate";
import {
  ACTIVITY_LABEL,
  assertHonestLabel,
  DISCOVERY_THRESHOLD,
  DISCOVERY_THRESHOLD_TEXT,
  formatProbability,
  mayShowProbability,
} from "@/lib/science";
import type { PathogenKey } from "@/lib/types";
import type { RawSearchParams } from "@/lib/url";

/* ------------------------------------------------------------------ */
/* The two kinds of statement                                          */
/* ------------------------------------------------------------------ */

/**
 * A block of documented evidence: something recorded by a registry or a
 * laboratory. Solid rule, green, a filled diamond.
 */
export function DocumentedBlock({
  title,
  kicker = "Documented evidence",
  children,
  id,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-[calc(var(--header-h,4rem)+1rem)] border border-rule bg-raised p-4 md:p-6"
      style={{ borderTop: "3px solid var(--color-clinical)" }}
    >
      <p className="m-0 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-clinical">
        <span aria-hidden="true">◆</span>
        {kicker}
      </p>
      <h2 className="m-0 mt-1.5 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A block of model output: nothing in it was measured. Dashed rule, indigo, a
 * triangle — so it cannot be mistaken for the block above even in greyscale.
 */
export function ComputationalBlock({
  title,
  kicker = "Computational · model output, nothing measured",
  children,
  id,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-[calc(var(--header-h,4rem)+1rem)] border border-dashed border-rule-strong bg-raised p-4 md:p-6"
      style={{ borderTop: "3px dashed var(--color-computational)" }}
    >
      <p className="m-0 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-computational">
        <span aria-hidden="true">▲</span>
        {kicker}
      </p>
      <h2 className="m-0 mt-1.5 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* A probability, labelled                                             */
/* ------------------------------------------------------------------ */

/**
 * One pathogen's prediction as a row: name, value and label. The label is part
 * of the component, not the caller's.
 */
export function ActivityRow({
  pathogenKey,
  pathogenLabel,
  probability,
  note,
}: {
  pathogenKey: PathogenKey;
  pathogenLabel: string;
  probability: number | null;
  note?: ReactNode;
}) {
  assertHonestLabel(ACTIVITY_LABEL);
  const shown = mayShowProbability(pathogenKey, probability);
  const meets = shown && probability >= DISCOVERY_THRESHOLD;
  const fraction = shown ? Math.max(0, Math.min(1, probability)) : 0;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-rule-soft py-3 last:border-b-0">
      <span className="font-display text-[15px] font-semibold text-ink">{pathogenLabel}</span>
      {shown ? (
        <span className="text-right">
          <span
            className="font-mono text-[20px] font-semibold tabular-nums"
            style={{ color: meets ? "var(--color-computational)" : "var(--color-ink-2)" }}
          >
            {formatProbability(probability, 1)}
          </span>{" "}
          <span className="text-[12px] text-muted">{ACTIVITY_LABEL}</span>
        </span>
      ) : (
        <span className="text-right text-[12px] text-muted">No prediction available</span>
      )}
      {shown ? (
        <span aria-hidden="true" className="relative col-span-2 block h-[3px] bg-sunken">
          <span
            className="absolute inset-y-0 left-0 block"
            style={{
              width: `${(fraction * 100).toFixed(2)}%`,
              background: meets ? "var(--color-computational)" : "var(--color-faint)",
            }}
          />
          <span
            className="absolute -top-[3px] block h-[9px] w-px bg-ink"
            style={{ left: `${DISCOVERY_THRESHOLD * 100}%` }}
          />
        </span>
      ) : null}
      {shown || note ? (
        <span className="col-span-2 text-[12px] leading-relaxed text-muted">
          {shown
            ? meets
              ? `At or above the ${DISCOVERY_THRESHOLD_TEXT} level this site uses to surface candidates.`
              : `Below the ${DISCOVERY_THRESHOLD_TEXT} level this site uses to surface candidates.`
            : null}
          {note ? <> {note}</> : null}
        </span>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

/**
 * Other medicines with AI-predicted activity against one pathogen. Each opens
 * the same investigation view as the medicine that was searched.
 */
export function CandidateList({
  data,
  pathogenLabel,
  path,
  params,
  anchor,
  pageParam,
}: {
  data: CandidatePage;
  pathogenLabel: string;
  path: string;
  params: RawSearchParams;
  anchor: string;
  pageParam: string;
}) {
  if (data.total === 0) {
    return (
      <p className="m-0 text-[13px] leading-relaxed text-ink-2">
        No other medicine in this dataset reaches {DISCOVERY_THRESHOLD_TEXT} AI-predicted
        activity against {pathogenLabel}.
      </p>
    );
  }

  return (
    <div>
      <p className="m-0 mb-3 font-mono text-[11px] text-muted">
        Listed by AI-predicted activity, high → low. The order is not a ranking of which
        medicine is better.
      </p>
      <ul className="m-0 grid list-none gap-px border border-rule bg-rule p-0 sm:grid-cols-2 xl:grid-cols-3">
        {data.rows.map((c) => (
          <li key={c.moleculeId} className="bg-raised">
            <Link
              href={`/investigate/${encodeURIComponent(c.moleculeId)}`}
              className="group flex h-full min-h-[76px] flex-col justify-between gap-2 p-3.5 no-underline hover-row"
            >
              <span className="font-display text-[15px] font-semibold leading-snug text-ink group-hover:underline group-hover:decoration-accent">
                {medicineName(c.name)}
              </span>
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[12px] text-ink-2">
                  <span className="font-mono text-[14px] font-semibold tabular-nums text-computational">
                    {formatProbability(c.probability, 1)}
                  </span>{" "}
                  {ACTIVITY_LABEL} · {pathogenLabel}
                </span>
                {c.labMeasured ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-experimental">
                    ■ lab data exists
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data.total > data.pageSize ? (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          path={path}
          params={params}
          unit="medicines"
          param={pageParam}
          anchor={anchor}
        />
      ) : (
        <p className="m-0 mt-3 font-mono text-[11px] text-muted">
          {data.total.toLocaleString("en-GB")} {data.total === 1 ? "medicine" : "medicines"}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registered studies                                                  */
/* ------------------------------------------------------------------ */

export const STUDY_NOTE =
  "A registration describes a study; it does not establish a positive result.";

function StudyRow({ study }: { study: Study }) {
  const conditions = splitConditions(study.conditions);
  const interventions = splitConditions(study.interventions);
  return (
    <li className="grid gap-x-5 gap-y-2 border-b border-rule-soft px-3 py-3.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_7.5rem_8.5rem]">
      <div className="min-w-0">
        <p className="m-0 text-[13px] leading-snug text-ink">{study.title ?? "Untitled registration"}</p>
        <p className="m-0 mt-1 font-mono text-[11px] text-muted">
          {study.url ? (
            <a href={study.url} target="_blank" rel="noreferrer">
              {study.nctId}
            </a>
          ) : (
            study.nctId
          )}
          {study.startDate ? ` · start date ${study.startDate}` : ""}
        </p>
      </div>
      <Cell label="Condition">{conditions.length ? conditions.join("; ") : "Not recorded"}</Cell>
      <Cell label="Intervention">
        {interventions.length ? interventions.join("; ") : "Not recorded"}
      </Cell>
      <Cell label="Phase">{formatPhase(study.phase)}</Cell>
      <Cell label="Registry status">{formatStatus(study.status)}</Cell>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-[12px] leading-snug text-ink-2">
      <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fainter md:hidden">
        {label}
      </span>
      <span className="break-words">{children}</span>
    </div>
  );
}

export function StudyList({
  data,
  path,
  params,
  anchor,
  pageParam,
  empty,
}: {
  data: StudyPage;
  path: string;
  params: RawSearchParams;
  anchor: string;
  pageParam: string;
  empty: ReactNode;
}) {
  if (data.total === 0) {
    return <div className="border border-rule bg-raised p-4 text-[13px] text-ink-2">{empty}</div>;
  }
  return (
    <div>
      <div className="border border-rule bg-raised">
        <div
          aria-hidden="true"
          className="hidden gap-x-5 border-b border-rule-strong bg-sunken px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_7.5rem_8.5rem]"
        >
          <span>Study</span>
          <span>Condition</span>
          <span>Intervention</span>
          <span>Phase</span>
          <span>Registry status</span>
        </div>
        <ul className="m-0 list-none p-0" aria-label="Registered studies">
          {data.rows.map((s) => (
            <StudyRow key={s.nctId} study={s} />
          ))}
        </ul>
      </div>
      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        path={path}
        params={params}
        unit={data.total === 1 ? "registered study" : "registered studies"}
        param={pageParam}
        anchor={anchor}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What a result does not establish                                    */
/* ------------------------------------------------------------------ */

export function DoesNotEstablish({ extra }: { extra?: string[] }) {
  const lines = [
    "AI-predicted activity is not clinical efficacy.",
    "A registered study is not a positive result.",
    "FDA approval for an existing use is not approval for a new indication.",
    ...(extra ?? []),
  ];
  return (
    <aside
      aria-labelledby="not-established"
      className="border border-rule bg-raised p-4 md:p-6"
      style={{ borderLeft: "3px solid var(--color-none)" }}
    >
      <h2 id="not-established" className="m-0 font-display text-[17px] font-semibold text-ink">
        What this result does not establish
      </h2>
      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
            <span aria-hidden="true" className="text-none">
              ○
            </span>
            {line}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** A heading row for a section of the investigation view. */
export function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
      <h2 className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {note ? <p className="m-0 font-mono text-[11px] text-muted">{note}</p> : null}
    </div>
  );
}
