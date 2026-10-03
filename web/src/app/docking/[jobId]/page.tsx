import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Page } from "@/components/primitives";
import { medicineName } from "@/lib/format";
import { getDockingJob } from "@/lib/queries/docking";
import { DOCKING_SCREENING_TARGET_KCAL_MOL } from "@/lib/science";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Docking result" };

/**
 * One docking job: the score, every pose, the exact inputs (with checksums),
 * the configuration and the command that produced it, and the files to
 * download. Enough to reproduce the run.
 */
export default async function DockingJobPage(props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const job = await getDockingJob(id);
  if (!job) notFound();
  const r = job.result;

  return (
    <Page>
      <p className="m-0 pt-4 md:pt-10">
        <Link href="/docking#results" className="text-[13px] text-ink-2 underline decoration-rule-strong underline-offset-4">
          ← All docking results
        </Link>
      </p>
      <header className="mt-4 max-w-[860px]">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.14em] text-computational">
          Docking result · computational
        </p>
        <h1 className="m-0 mt-2 font-display text-[clamp(28px,4.4vw,48px)] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
          {medicineName(job.drug)} <span className="text-muted">×</span> {job.proteinName}
        </h1>
        <p className="m-0 mt-2 text-[15px] italic text-ink-2">{job.organism}</p>
      </header>

      {r ? (
        <section className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-card border border-rule bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Best docking score</p>
            <p className="m-0 mt-2 font-mono text-[40px] tabular-nums leading-none text-computational">
              {job.bestAffinity!.toFixed(3)}
            </p>
            <p className="m-0 mt-1 text-[13px] text-ink-2">kcal/mol, AutoDock Vina {job.engineVersion}</p>
            <p className="m-0 mt-4 text-[12px] leading-relaxed text-muted">
              A predicted protein interaction, not a measured one. This project screens at{" "}
              {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol, its own mark rather than a universal cutoff. It
              does not show that {medicineName(job.drug)} treats {job.organism.split(" (")[0]} infection; that would
              require experimental and clinical evidence.
            </p>
          </div>
          <div className="rounded-card border border-rule bg-raised p-5 lg:col-span-2">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {r.poses.length} poses (Vina output)
            </p>
            <table className="mt-3 w-full border-collapse text-left font-mono text-[12px] tabular-nums">
              <thead>
                <tr className="border-b border-rule text-muted">
                  <th className="py-1.5 font-normal">Rank</th>
                  <th className="py-1.5 text-right font-normal">Score (kcal/mol)</th>
                  <th className="py-1.5 text-right font-normal">RMSD l.b. (Å)</th>
                  <th className="py-1.5 text-right font-normal">RMSD u.b. (Å)</th>
                </tr>
              </thead>
              <tbody>
                {r.poses.map((p) => (
                  <tr key={p.rank} className="border-b border-rule-soft last:border-0">
                    <td className="py-1.5">{p.rank}</td>
                    <td className="py-1.5 text-right text-ink">{p.affinity.toFixed(3)}</td>
                    <td className="py-1.5 text-right">{p.rmsd_lb.toFixed(3)}</td>
                    <td className="py-1.5 text-right">{p.rmsd_ub.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-3">
              {r.poseArtifact ? (
                <a href={`/api/docking/artifacts/${r.poseArtifact.id}`} className="inline-flex min-h-10 items-center rounded-full bg-ink px-4 font-display text-[13px] font-semibold text-raised no-underline">
                  Download poses (PDBQT)
                </a>
              ) : null}
              {r.logArtifact ? (
                <a href={`/api/docking/artifacts/${r.logArtifact.id}`} className="inline-flex min-h-10 items-center rounded-full border border-rule-strong px-4 font-display text-[13px] font-semibold text-ink no-underline">
                  Download Vina log
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-card border border-rule bg-raised p-5">
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.12em] text-muted">{job.status.replaceAll("_", " ")}</p>
          <p className="m-0 mt-2 text-[15px] text-ink-2">
            {job.status === "QUEUED" || job.status === "RUNNING"
              ? "Not yet docked. No score exists for this pair yet."
              : "No docking score exists for this pair. This is not evidence of no interaction."}
          </p>
          {job.error ? <p className="m-0 mt-2 font-mono text-[12px] text-ink-2">{job.error}</p> : null}
        </section>
      )}

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Target">
          <Item k="Protein" v={job.proteinName} />
          <Item k="Organism" v={job.organism} />
          <Item k="Gene" v={job.gene} />
          <Item k="UniProt" v={job.uniprotId} />
          <Item k="PDB ID" v={job.pdbId} link={job.pdbId ? `https://www.rcsb.org/structure/${job.pdbId}` : undefined} />
          <Item k="Chain" v={job.chain} />
          <Item k="Structure source" v={job.targetStructureSource} />
          <Item k="Binding site" v={job.bindingSite} />
          <Item k="Receptor preparation" v={job.receptorMethod} small />
        </Panel>
        <Panel title="Ligand">
          <Item k="Medicine" v={medicineName(job.drug)} link={`/investigate/${job.ligandId}`} />
          <Item k="InChIKey" v={job.ligandId} mono />
          <Item k="SMILES" v={job.canonicalSmiles} mono small />
          <Item k="Structure source" v={job.ligandStructureSource} />
          <Item k="Ligand preparation" v={job.ligandMethod} small />
        </Panel>
      </section>

      <section className="mt-4">
        <Panel title="Docking configuration and provenance">
          {r ? (
            <>
              <Item k="Engine" v={`${job.engine} ${job.engineVersion}`} />
              <Item k="Exhaustiveness" v={String(r.exhaustiveness)} />
              <Item k="Number of modes" v={String(r.numModes)} />
              <Item k="Energy range" v={`${r.energyRange} kcal/mol`} />
              <Item k="Random seed" v={String(r.seed)} />
              <Item k="Box centre (Å)" v={r.center.map((c) => c.toFixed(3)).join(", ")} mono />
              <Item k="Box size (Å)" v={r.size.join(" × ")} mono />
              <Item k="Receptor SHA-256" v={r.receptorSha256} mono small />
              <Item k="Ligand SHA-256" v={r.ligandSha256} mono small />
              {r.poseArtifact ? <Item k="Pose file SHA-256" v={r.poseArtifact.sha256} mono small /> : null}
              <Item k="Command" v={r.command} mono small />
              <Item k="Worker" v={`${r.workerId} (${r.cpu} CPU thread)`} mono small />
            </>
          ) : null}
          <Item k="Configuration hash" v={job.configHash} mono small />
          <Item k="Run" v={job.runId} mono />
          <Item k="Job" v={`#${job.jobId}, attempt ${job.attemptCount}`} mono />
          <Item k="Started" v={job.startedAt} mono />
          <Item k="Completed" v={job.completedAt} mono />
          <Item k="Docking time" v={job.durationSeconds == null ? null : `${job.durationSeconds.toFixed(1)} s`} mono />
        </Panel>
      </section>
    </Page>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-rule bg-raised p-4 md:p-5">
      <h2 className="m-0 text-[13px] font-medium text-ink-2">{title}</h2>
      <dl className="m-0 mt-3 space-y-2.5">{children}</dl>
    </div>
  );
}

function Item({ k, v, mono, small, link }: { k: string; v: string | null; mono?: boolean; small?: boolean; link?: string }) {
  const cls = `m-0 break-words text-ink ${mono ? "font-mono" : ""} ${small ? "text-[12px]" : "text-[14px]"}`;
  return (
    <div className="grid gap-1 sm:grid-cols-[170px_1fr] sm:gap-3">
      <dt className="text-[12px] text-muted">{k}</dt>
      <dd className={cls}>
        {v == null ? (
          "—"
        ) : link ? (
          <a href={link} className="underline decoration-accent underline-offset-4">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}
