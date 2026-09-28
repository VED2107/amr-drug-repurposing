import Link from "next/link";
import type { ReactNode } from "react";

import { Pagination } from "@/components/data";
import { StructureFigure } from "@/components/molecular/StructureFigure";
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
import { trialRecord } from "@/lib/links";
import type { RawSearchParams } from "@/lib/url";

import { EvidenceIcon, type EvidenceKind } from "./icons";

export { EvidenceIcon } from "./icons";

/* ------------------------------------------------------------------ */
/* The two kinds of statement                                          */
/* ------------------------------------------------------------------ */

/**
 * The heading of an evidence block: the shape of its kind, the title, and the
 * kind named in words on the same line. Nothing sits above the title.
 */
function BlockHead({ kind, title, tag }: { kind: EvidenceKind; title: string; tag: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="m-0 flex items-center gap-2.5 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
        <EvidenceIcon kind={kind} size={16} />
        {title}
      </h2>
      <span
        className="inline-flex items-center rounded-card border px-2 py-0.5 text-[12px] font-medium"
        style={{
          color: `var(--color-${kind})`,
          borderColor: "currentColor",
          borderStyle: kind === "computational" ? "dashed" : "solid",
        }}
      >
        {tag}
      </span>
    </div>
  );
}

/**
 * Documented evidence: something recorded by a registry or a laboratory.
 * Solid frame, green, a filled diamond.
 */
export function DocumentedBlock({
  title,
  tag = "Documented evidence",
  children,
  id,
}: {
  title: string;
  tag?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-card border border-rule bg-raised p-4 shadow-[0_1px_2px_rgba(18,19,15,0.04)] md:p-6"
      style={{ boxShadow: "inset 0 3px 0 var(--color-clinical)" }}
    >
      <BlockHead kind="clinical" title={title} tag={tag} />
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * Model output: nothing in it was measured. Dashed frame, indigo, an open
 * triangle — so it cannot be mistaken for documented evidence even in greyscale.
 */
export function ComputationalBlock({
  title,
  tag = "AI prediction · nothing measured",
  children,
  id,
}: {
  title: string;
  tag?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-card border border-dashed bg-paper p-4 md:p-6"
      style={{ borderColor: "color-mix(in oklab, var(--color-computational) 45%, var(--color-rule))" }}
    >
      <BlockHead kind="computational" title={title} tag={tag} />
      <div className="mt-5">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* A probability, labelled                                             */
/* ------------------------------------------------------------------ */

/**
 * One pathogen's prediction as a row: name, value and label, with the
 * discovery floor marked on its bar. The label is part of the component, not
 * the caller's.
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
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 border-b border-rule-soft py-4 first:pt-0 last:border-b-0 last:pb-0">
      <span className="font-display text-[16px] font-semibold text-ink">{pathogenLabel}</span>
      {shown ? (
        <span className="text-right">
          <span
            className="font-mono text-[24px] font-medium tabular-nums leading-none"
            style={{ color: meets ? "var(--color-computational)" : "var(--color-ink-2)" }}
          >
            {formatProbability(probability, 1)}
          </span>{" "}
          <span className="text-[12px] text-muted">{ACTIVITY_LABEL}</span>
        </span>
      ) : (
        <span className="text-right text-[13px] text-muted">No prediction available</span>
      )}
      {shown ? (
        <span aria-hidden="true" className="relative col-span-2 block h-1 rounded-full bg-sunken">
          <span
            className="absolute inset-y-0 left-0 block rounded-full"
            style={{
              width: `${(fraction * 100).toFixed(2)}%`,
              background: meets ? "var(--color-computational)" : "var(--color-faint)",
            }}
          />
          <span
            className="absolute -top-1 block h-3 w-px bg-ink-2"
            style={{ left: `${DISCOVERY_THRESHOLD * 100}%` }}
          />
        </span>
      ) : null}
      {shown || note ? (
        <span className="col-span-2 text-[12px] leading-relaxed text-muted">
          {shown
            ? meets
              ? `At or above the ${DISCOVERY_THRESHOLD_TEXT} mark this site uses to surface candidates.`
              : `Below the ${DISCOVERY_THRESHOLD_TEXT} mark this site uses to surface candidates.`
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
 * Other medicines with AI-predicted activity against one pathogen. Each shows
 * its structure and opens the same investigation view as the medicine that was
 * searched.
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
      <p className="m-0 text-[14px] leading-relaxed text-ink-2">
        No other medicine in this dataset reaches {DISCOVERY_THRESHOLD_TEXT} AI-predicted activity
        against {pathogenLabel}.
      </p>
    );
  }

  return (
    <div>
      <p className="m-0 mb-4 text-[13px] leading-relaxed text-muted">
        Listed by AI-predicted activity, high to low. The order is not a ranking of which medicine
        is better.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {data.rows.map((c) => (
          <li key={c.moleculeId}>
            <Link
              href={`/investigate/${encodeURIComponent(c.moleculeId)}`}
              className="amr-card group grid h-full grid-cols-[minmax(0,1fr)_92px] items-center gap-3 rounded-card border border-rule bg-raised p-3.5 no-underline"
            >
              <span className="flex min-w-0 flex-col gap-2">
                <span className="font-display text-[15px] font-semibold leading-snug text-ink decoration-accent underline-offset-4 group-hover:underline">
                  {medicineName(c.name)}
                </span>
                <span className="text-[12px] leading-snug text-ink-2">
                  <span className="font-mono text-[17px] font-medium tabular-nums text-computational">
                    {formatProbability(c.probability, 1)}
                  </span>{" "}
                  {ACTIVITY_LABEL}
                  <span className="block text-muted">against {pathogenLabel}</span>
                </span>
                {c.labMeasured ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-experimental">
                    <EvidenceIcon kind="experimental" size={10} />
                    Lab records exist
                  </span>
                ) : null}
              </span>
              <span className="grid h-[76px] place-items-center rounded-card bg-paper p-1">
                <StructureFigure smiles={c.smiles} label={medicineName(c.name)} width={184} height={140} compact />
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

const GRID =
  "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_7.5rem_8.5rem]";

function StudyRow({ study }: { study: Study }) {
  const conditions = splitConditions(study.conditions);
  const interventions = splitConditions(study.interventions);
  return (
    <li className={`grid gap-x-5 gap-y-2 border-b border-rule-soft px-4 py-4 last:border-b-0 ${GRID}`}>
      <div className="min-w-0">
        <p className="m-0 text-[14px] leading-snug text-ink">{study.title ?? "Untitled registration"}</p>
        <p className="m-0 mt-1.5 font-mono text-[11px] text-muted">
          <a href={study.url ?? trialRecord(study.nctId)} target="_blank" rel="noreferrer">
            {study.nctId} ↗
          </a>
          {study.startDate ? ` · start ${study.startDate}` : ""}
        </p>
      </div>
      <Cell label="Condition">{listed(conditions)}</Cell>
      <Cell label="Intervention">{listed(interventions)}</Cell>
      <Cell label="Phase">{formatPhase(study.phase)}</Cell>
      <Cell label="Registry status">{formatStatus(study.status)}</Cell>
    </li>
  );
}

/** A registry list, capped so one study cannot take over the table. */
function listed(items: string[], max = 4): string {
  if (items.length === 0) return "Not recorded";
  if (items.length <= max) return items.join("; ");
  return `${items.slice(0, max).join("; ")} +${items.length - max} more`;
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-[13px] leading-snug text-ink-2">
      <span className="mr-2 text-[11px] font-medium text-muted md:hidden">{label}</span>
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
    return (
      <p className="m-0 flex items-start gap-2.5 rounded-card border border-rule bg-raised p-4 text-[14px] leading-relaxed text-ink-2">
        <span className="mt-1">
          <EvidenceIcon kind="none" />
        </span>
        <span>{empty}</span>
      </p>
    );
  }
  return (
    <div>
      <div className="overflow-hidden rounded-card border border-rule bg-raised">
        <div
          aria-hidden="true"
          className={`hidden gap-x-5 border-b border-rule bg-sunken px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted md:grid ${GRID}`}
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
    <aside aria-labelledby="not-established" className="rounded-card border border-rule bg-sunken p-4 md:p-6">
      <h2 id="not-established" className="m-0 font-display text-[17px] font-semibold text-ink">
        What this result does not establish
      </h2>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0 md:grid-cols-3 md:gap-6">
        {lines.map((line) => (
          <li key={line} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
            <span className="mt-[5px]">
              <EvidenceIcon kind="none" size={12} />
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
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2.5">
      <h2 className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {note ? <p className="m-0 text-[13px] text-muted">{note}</p> : null}
    </div>
  );
}

/** A state line: "No evidence found", "Not yet checked", "Not yet docked". */
export function StateNote({
  kind,
  head,
  children,
}: {
  kind: "none" | "unchecked";
  head: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold" style={{ color: `var(--color-${kind})` }}>
        <EvidenceIcon kind={kind} size={12} />
        {head}
      </p>
      <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink-2">{children}</p>
    </div>
  );
}
