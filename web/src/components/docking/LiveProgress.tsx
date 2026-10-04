"use client";

import { useEffect, useState } from "react";

import type { DockingStatus, DockingWorker } from "@/lib/queries/docking";

/**
 * Campaign progress, refreshed from /api/docking/status every 15 seconds.
 *
 * Every number here is computed by the database on the request that returned
 * it. The bar shows finished jobs (completed + failed) as two segments; the
 * ETA appears only when recent throughput is measurable, and is labelled as an
 * estimate from the last 15 minutes.
 */
export function LiveProgress({ initial }: { initial: DockingStatus }) {
  const [s, setS] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/docking/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as DockingStatus & { available: boolean };
        if (alive && next.available) {
          setS(next);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    };
    const id = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const n = (v: number) => v.toLocaleString("en-GB");
  const j = s.jobs;
  const failedAll = j.dockingFailed + j.structureUnavailable + j.ligandPreparationFailed + j.targetPreparationFailed;
  const pctDone = j.expected ? (100 * j.completed) / j.expected : 0;
  const pctFailed = j.expected ? (100 * failedAll) / j.expected : 0;
  // Elapsed at the moment the database was read, so render stays pure.
  const elapsed = s.startedAt ? new Date(s.readAt).getTime() - new Date(s.startedAt).getTime() : null;

  return (
    <section aria-labelledby="progress-h" aria-live="polite" className="rounded-card border border-rule bg-raised p-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="progress-h" className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          04 · Check fit · molecular docking
        </h2>
        <p suppressHydrationWarning className="m-0 font-mono text-[11px] text-muted">
          {stale ? "Could not refresh; showing the last reading" : `Read from the database ${time(s.readAt)}`}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
        <Big value={n(s.medicines.total)} label="medicines" />
        <Big value={`× ${n(s.targets.length)}`} label="pathogen protein targets" />
        <Big value={n(j.expected)} label="docking jobs" />
      </div>

      <p className="m-0 mt-6 font-mono text-[clamp(20px,2.4vw,28px)] tabular-nums text-ink">
        {n(j.completed)} <span className="text-muted">/ {n(j.expected)} completed</span>
        <span className="ml-3 text-computational">{s.percentCompleted.toFixed(1)}%</span>
      </p>
      <div
        role="progressbar"
        aria-label="Docking jobs completed"
        aria-valuemin={0}
        aria-valuemax={j.expected}
        aria-valuenow={j.completed}
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-sunken"
      >
        <span className="block h-full bg-computational" style={{ width: `${pctDone}%` }} />
        <span className="block h-full bg-faint" style={{ width: `${pctFailed}%` }} />
      </div>

      {s.priorityPhase ? <PriorityPhase phase={s.priorityPhase} paused={s.runStatus === "PAUSED"} /> : null}

      <dl className="m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Running" value={n(j.running)} />
        <Stat label="Queued" value={n(j.queued)} />
        <Stat label="Docking failed" value={n(j.dockingFailed)} />
        <Stat
          label="Input unavailable"
          value={n(j.structureUnavailable + j.ligandPreparationFailed + j.targetPreparationFailed)}
          note="structure unavailable or preparation failed; not docking failures"
        />
        <Stat
          label="Throughput"
          value={`${s.throughput.jobsPerMinute2h ?? s.throughput.jobsPerMinute15m} jobs/min`}
          note={`last 2 hours · last hour ${s.throughput.jobsPerMinute1h ?? "—"} · last 15 min ${s.throughput.jobsPerMinute15m}`}
        />
        <Stat
          label="Estimated remaining"
          value={s.etaMinutes == null ? "Not yet measurable" : duration(s.etaMinutes * 60_000)}
          note={
            s.etaMinutes == null
              ? "needs 10 completions in the last 15 minutes"
              : `rate over the ${s.etaBasis ?? "last 15 minutes"}, about ${time(s.estimatedCompletionAt!)}; the faster ligands are docked first, so later jobs take longer and this is a lower bound`
          }
        />
        <Stat label="Elapsed" value={elapsed == null ? "—" : duration(elapsed)} />
        <Stat
          label="Workers online"
          value={`${n(s.workers.online)} · ${n(s.workers.slots)} slots`}
          note="each slot runs one AutoDock Vina process"
        />
      </dl>

      <Workers workers={s.workers} />
    </section>
  );
}

/**
 * The queue's first phase: medicines ranked by the AI models are docked before
 * the rest. A ranking says which medicines to check first; it is not a result.
 */
function PriorityPhase({
  phase,
  paused,
}: {
  phase: NonNullable<DockingStatus["priorityPhase"]>;
  paused: boolean;
}) {
  const n = (v: number) => v.toLocaleString("en-GB");
  return (
    <p className="m-0 mt-4 text-[13px] leading-snug text-ink-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Docking first · </span>
      the {n(phase.size)} medicines the AI models rank highest for any of the four pathogens:{" "}
      <span className="font-mono tabular-nums text-ink">
        {n(phase.finished)} / {n(phase.size)}
      </span>{" "}
      finished, {n(phase.jobsLeft)} of their jobs left. The other medicines stay queued behind them
      {paused ? "; the run is paused now that this phase is done." : "."}
    </p>
  );
}

const KIND_LABEL: Record<string, string> = { local: "Local", kaggle: "Kaggle", colab: "Colab" };

/**
 * Where the work is running. Workers are listed while their heartbeat is under
 * three minutes old; throughput by kind counts every completion in the last 15
 * minutes, including workers that have since stopped.
 */
function Workers({ workers }: { workers: DockingStatus["workers"] }) {
  const kinds = Object.entries(workers.byKind ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const list: DockingWorker[] = workers.list ?? [];
  const total = kinds.reduce((t, [, k]) => t + k.jobsPerMinute15m, 0);
  if (!kinds.length) return null;
  return (
    <div className="mt-6 border-t border-rule pt-4">
      <h3 className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Workers</h3>
      <dl className="m-0 mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {kinds.map(([kind, k]) => (
          <Stat
            key={kind}
            label={KIND_LABEL[kind] ?? kind}
            value={`${k.online} · ${k.slots} slots`}
            note={`${k.jobsPerMinute15m} jobs/min, last 15 minutes`}
          />
        ))}
        <Stat
          label="Total"
          value={`${workers.online} · ${workers.slots} slots`}
          note={`${Math.round(total * 100) / 100} jobs/min, last 15 minutes`}
        />
      </dl>
      {list.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[12px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="py-1.5 pr-4 font-normal">Worker</th>
                <th className="py-1.5 pr-4 font-normal">Where</th>
                <th className="py-1.5 pr-4 font-normal">CPUs</th>
                <th className="py-1.5 pr-4 font-normal">Slots</th>
                <th className="py-1.5 pr-4 font-normal">Running jobs</th>
                <th className="py-1.5 pr-4 font-normal">Completed</th>
                <th className="py-1.5 pr-4 font-normal">Jobs/min</th>
                <th className="py-1.5 font-normal">Last heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.workerId} className="border-t border-rule text-ink">
                  <td className="py-1.5 pr-4 break-all">{w.workerId}</td>
                  <td className="py-1.5 pr-4">{KIND_LABEL[w.kind] ?? w.kind}</td>
                  <td className="py-1.5 pr-4">{w.cpuCount ?? "—"}</td>
                  <td className="py-1.5 pr-4">{w.concurrency}</td>
                  <td className="py-1.5 pr-4">{w.currentJobs.length ? w.currentJobs.join(", ") : "—"}</td>
                  <td className="py-1.5 pr-4">{w.completed.toLocaleString("en-GB")}</td>
                  <td className="py-1.5 pr-4">{w.jobsPerMinute15m}</td>
                  <td suppressHydrationWarning className="py-1.5">
                    {w.lastHeartbeat ? new Date(w.lastHeartbeat).toLocaleTimeString("en-GB") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <p className="m-0">
      <span className="block font-display text-[clamp(28px,3.6vw,44px)] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </span>
      <span className="mt-1.5 block text-[13px] text-ink-2">{label}</span>
    </p>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd suppressHydrationWarning className="m-0 mt-1 font-mono text-[15px] tabular-nums text-ink">{value}</dd>
      {note ? <dd suppressHydrationWarning className="m-0 mt-0.5 text-[11px] leading-snug text-muted">{note}</dd> : null}
    </div>
  );
}

function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function time(isoString: string): string {
  return new Date(isoString).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
