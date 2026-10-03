import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/data";
import { LiveProgress } from "@/components/docking/LiveProgress";
import { OperatorActions } from "@/components/docking/OperatorActions";
import { Page } from "@/components/primitives";
import { medicineName } from "@/lib/format";
import { getDockingStatus, JOB_STATUSES, listDockingResults } from "@/lib/queries/docking";
import { DOCKING_SCREENING_TARGET_KCAL_MOL } from "@/lib/science";
import { firstValue, numberParam, type RawSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Molecular docking",
  description:
    "AutoDock Vina docking of every approved medicine in the library against the selected bacterial protein targets: live progress and results.",
};

const STATUS_TEXT: Record<string, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Docking result",
  DOCKING_FAILED: "Docking failed",
  FAILED: "Failed",
  STRUCTURE_UNAVAILABLE: "Structure unavailable",
  LIGAND_PREPARATION_FAILED: "Ligand preparation failed",
  TARGET_PREPARATION_FAILED: "Target preparation failed",
  CANCELLED: "Cancelled",
};

const PATHOGEN_TEXT: Record<string, string> = {
  mrsa: "MRSA",
  ecoli: "E. coli",
  kpneumoniae: "K. pneumoniae",
  mtb: "M. tuberculosis",
};

/**
 * CHECK FIT, stage 04: the batch docking campaign. Progress is live from the
 * job queue; results are the stored AutoDock Vina outputs. A docking score is a
 * computational ranking of predicted fit to one protein structure. It is not
 * evidence that a medicine treats an infection.
 */
export default async function DockingPage(props: { searchParams: Promise<RawSearchParams> }) {
  const params = await props.searchParams;
  const filters = {
    drug: (firstValue(params, "drug") ?? "").trim() || undefined,
    target: firstValue(params, "target") || undefined,
    organism: firstValue(params, "organism") || undefined,
    status: firstValue(params, "status") || undefined,
    outcome: (firstValue(params, "outcome") as "completed" | "failed" | undefined) || undefined,
    minAffinity: numberParam(params, "min"),
    maxAffinity: numberParam(params, "max"),
    run: firstValue(params, "run") || undefined,
    sort: firstValue(params, "sort") === "recent" ? ("recent" as const) : ("affinity" as const),
    page: numberParam(params, "page") ?? 1,
    pageSize: 50,
  };
  const [status, results] = await Promise.all([
    getDockingStatus().catch(() => null),
    listDockingResults(filters).catch(() => null),
  ]);
  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <Page>
      <header className="max-w-[860px] pt-4 md:pt-10">
        <p className="m-0 font-mono text-[13px] tabular-nums text-accent">04 · Check fit</p>
        <h1 className="m-0 mt-2 font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Molecular docking
        </h1>
        <p className="m-0 mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-2">
          Every approved medicine in the library is docked with AutoDock Vina into one experimentally
          solved protein from each of the four bacteria. Each job is a real Vina run; its score, poses,
          inputs and settings are stored and can be downloaded.
        </p>
      </header>

      <aside className="mt-6 max-w-[860px] border-l-2 border-computational pl-4 text-[14px] leading-relaxed text-ink-2">
        <strong className="font-semibold text-ink">Computational evidence only.</strong> A docking score
        (kcal/mol) is a structural hypothesis: how well a rigid model of one protein pocket and a flexible
        molecule are predicted to fit. It ranks candidates for further study. It is not clinical evidence, it
        does not show that a medicine treats an infection, and every result requires experimental validation.{" "}
        {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol is this project&rsquo;s screening mark, not a
        universal binding cutoff.
      </aside>

      {!status ? (
        <p className="mt-10 rounded-card border border-rule bg-raised p-5 text-[15px] text-ink-2">
          No docking run has been started on this database yet.
        </p>
      ) : (
        <>
          <div className="mt-10">
            <LiveProgress initial={status} />
          </div>

          <section aria-labelledby="metrics-h" className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-card border border-rule bg-raised p-4 md:p-5 lg:col-span-2">
              <h2 id="metrics-h" className="m-0 text-[13px] font-medium text-ink-2">
                Campaign figures
              </h2>
              <dl className="m-0 mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Fig label="Total medicines" value={n(status.medicines.total)} />
                <Fig label="Total targets" value={n(status.targets.length)} />
                <Fig
                  label="Total docking jobs"
                  value={n(status.jobs.expected)}
                  note={`${n(status.medicines.total)} × ${n(status.targets.length)}`}
                />
                <Fig label="Completed" value={n(status.jobs.completed)} />
                <Fig label="Running" value={n(status.jobs.running)} />
                <Fig label="Queued" value={n(status.jobs.queued)} />
                <Fig label="Docking failed" value={n(status.jobs.dockingFailed)} note="Vina ran and failed or timed out" />
                <Fig
                  label="Structure unavailable"
                  value={n(status.jobs.structureUnavailable)}
                  note="no structure recorded for the medicine"
                />
                <Fig
                  label="Ligand preparation failed"
                  value={n(status.jobs.ligandPreparationFailed)}
                  note="e.g. elements Vina cannot score, several components"
                />
                <Fig
                  label="Average docking time"
                  value={status.averageDockingSeconds == null ? "—" : `${status.averageDockingSeconds} s`}
                  note="per job, one CPU thread"
                />
                <Fig
                  label="Docking success rate"
                  value={status.successRate == null ? "—" : `${(status.successRate * 100).toFixed(1)}%`}
                  note="of jobs Vina ran; unavailable inputs excluded"
                />
                <Fig
                  label="Medicines finished"
                  value={`${n(status.medicines.processed)} / ${n(status.medicines.total)}`}
                  note="every target job done or failed"
                />
              </dl>
              <div className="mt-5 border-t border-rule-soft pt-4">
                <OperatorActions failed={status.jobs.dockingFailed} />
                <p className="m-0 mt-2 text-[12px] leading-relaxed text-muted">
                  Operator actions need the operator token. From the worker host:{" "}
                  <code className="font-mono">npm run docking:retry-failed</code> ·{" "}
                  <code className="font-mono">npm run docking:resume</code>
                </p>
              </div>
            </div>

            <div className="rounded-card border border-rule bg-raised p-4 md:p-5">
              <h2 className="m-0 text-[13px] font-medium text-ink-2">Engine and configuration</h2>
              <dl className="m-0 mt-4 space-y-3 text-[13px]">
                <Row label="Docking engine" value={`${status.engine ?? "AutoDock Vina"} ${status.engineVersion ?? ""}`} />
                {status.configuration ? (
                  <>
                    <Row label="Exhaustiveness" value={String(status.configuration.exhaustiveness)} />
                    <Row label="Poses per job" value={`up to ${status.configuration.numModes}`} />
                    <Row label="Energy range" value={`${status.configuration.energyRange} kcal/mol`} />
                    <Row label="Random seed" value={String(status.configuration.seed)} />
                    <Row label="Search box" value={`${status.configuration.boxSize.join(" × ")} Å`} />
                  </>
                ) : null}
                <Row label="Configuration" value={status.configHash.slice(0, 16)} mono />
                <Row label="Current run" value={status.runId ?? "not started"} mono />
                <Row
                  label="Validation"
                  value={
                    status.validation
                      ? status.validation.passed
                        ? "passed (redocking + known pairs)"
                        : "did not pass"
                      : "not run"
                  }
                />
                <Row
                  label="Started"
                  value={status.startedAt ? new Date(status.startedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"}
                />
              </dl>
            </div>
          </section>

          <section aria-labelledby="targets-h" className="mt-4 rounded-card border border-rule bg-raised p-4 md:p-5">
            <h2 id="targets-h" className="m-0 text-[13px] font-medium text-ink-2">
              Bacterial protein targets
            </h2>
            <ul className="m-0 mt-4 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {status.targets.map((t) => (
                <li key={t.targetId}>
                  <p className="m-0 font-display text-[16px] font-semibold text-ink">{t.proteinName}</p>
                  <p className="m-0 mt-0.5 text-[12px] italic text-muted">{t.organism}</p>
                  <p className="m-0 mt-1 font-mono text-[12px] text-ink-2">
                    {t.pdbId ? (
                      <a href={`https://www.rcsb.org/structure/${t.pdbId}`} className="text-ink underline decoration-accent underline-offset-4">
                        PDB {t.pdbId}
                      </a>
                    ) : (
                      "no structure"
                    )}{" "}
                    · {t.status === "READY" ? "prepared" : t.status.toLowerCase().replaceAll("_", " ")}
                  </p>
                  <p className="m-0 mt-2 font-mono text-[13px] tabular-nums text-ink">
                    {n(t.completed)} <span className="text-muted">/ {n(status.medicines.total)} docked</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section id="results" aria-labelledby="results-h" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
          <h2 id="results-h" className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
            Docking results
          </h2>
          <p className="m-0 text-[13px] text-muted">
            More negative = stronger predicted fit. A ranking metric, not clinical efficacy.
          </p>
        </div>

        <form action="/docking#results" method="get" className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Medicine">
            <input name="drug" defaultValue={filters.drug ?? ""} placeholder="Name or InChIKey" className={inputCls} />
          </Field>
          <Field label="Target">
            <select name="target" defaultValue={filters.target ?? ""} className={inputCls}>
              <option value="">All targets</option>
              {status?.targets.map((t) => (
                <option key={t.targetId} value={t.targetId}>
                  {t.proteinName} ({PATHOGEN_TEXT[t.pathogenKey] ?? t.pathogenKey})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Organism">
            <select name="organism" defaultValue={filters.organism ?? ""} className={inputCls}>
              <option value="">All organisms</option>
              {Object.entries(PATHOGEN_TEXT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={filters.status ?? ""} className={inputCls}>
              <option value="">All statuses</option>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_TEXT[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome">
            <select name="outcome" defaultValue={filters.outcome ?? ""} className={inputCls}>
              <option value="">Any</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed or no input</option>
            </select>
          </Field>
          <Field label="Score from (kcal/mol)">
            <input name="min" type="number" step="0.1" defaultValue={filters.minAffinity ?? ""} placeholder="-12" className={inputCls} />
          </Field>
          <Field label="Score to (kcal/mol)">
            <input name="max" type="number" step="0.1" defaultValue={filters.maxAffinity ?? ""} placeholder="-7" className={inputCls} />
          </Field>
          <Field label="Sort">
            <select name="sort" defaultValue={filters.sort} className={inputCls}>
              <option value="affinity">Best docking score first</option>
              <option value="recent">Most recently completed</option>
            </select>
          </Field>
          {filters.run ? <input type="hidden" name="run" value={filters.run} /> : null}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="inline-flex min-h-10 items-center rounded-full bg-ink px-5 font-display text-[13px] font-semibold text-raised">
              Apply filters
            </button>
            <Link href="/docking#results" className="text-[13px] text-ink-2 underline decoration-rule-strong underline-offset-4">
              Clear
            </Link>
          </div>
        </form>

        {!results ? (
          <p className="text-[14px] text-ink-2">Results could not be read right now.</p>
        ) : results.total === 0 ? (
          <p className="text-[14px] text-ink-2">No docking jobs match these filters.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-card border border-rule">
              <table className="w-full min-w-[760px] border-collapse bg-raised text-left text-[13px]">
                <thead>
                  <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-3 py-2.5 font-normal">Medicine</th>
                    <th className="px-3 py-2.5 font-normal">Target</th>
                    <th className="px-3 py-2.5 text-right font-normal">Best score</th>
                    <th className="px-3 py-2.5 text-right font-normal">Poses</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-3 py-2.5 font-normal">Engine</th>
                    <th className="px-3 py-2.5 font-normal">Run</th>
                    <th className="px-3 py-2.5 font-normal">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((r) => (
                    <tr key={r.jobId} className="border-b border-rule-soft last:border-0">
                      <td className="px-3 py-2.5">
                        <Link href={`/docking/${r.jobId}`} className="font-medium text-ink underline decoration-accent underline-offset-4">
                          {medicineName(r.drug)}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {r.proteinName}
                        <span className="block text-[11px] text-muted">
                          {PATHOGEN_TEXT[r.pathogenKey] ?? r.pathogenKey} · PDB {r.pdbId}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
                        {r.bestAffinity == null ? "—" : `${r.bestAffinity.toFixed(2)} kcal/mol`}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.posesCount ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span title={r.error ?? undefined}>{STATUS_TEXT[r.status] ?? r.status}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">
                        {r.engine ? `Vina ${r.engineVersion}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted">{r.runId.slice(0, 19)}</td>
                      <td suppressHydrationWarning className="px-3 py-2.5 font-mono text-[12px] text-ink-2">
                        {r.completedAt ? r.completedAt.slice(0, 16).replace("T", " ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={results.page}
              pageSize={results.pageSize}
              total={results.total}
              path="/docking"
              params={params}
              unit="docking jobs"
              anchor="results"
            />
          </>
        )}
      </section>
    </Page>
  );
}

const inputCls =
  "amr-search-input min-h-10 w-full rounded-[10px] border border-rule bg-raised px-3 text-[14px] text-ink";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="m-0 mt-1 font-mono text-[20px] tabular-nums leading-none text-ink">{value}</dd>
      {note ? <dd className="m-0 mt-1 text-[11px] leading-snug text-muted">{note}</dd> : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`m-0 text-right text-ink ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}
