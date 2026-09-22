import Link from "next/link";

import { TableWrap, Td, Th, Tr } from "@/components/data";
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
  orDash,
} from "@/components/primitives";
import { getDatasetVersions, getModelVersions, getPathogens, getPipelineRuns } from "@/lib/queries/core";

export const revalidate = 300;

/**
 * Retraining.
 *
 * What triggers a retrain, what happens to the old model when a new one wins,
 * and what has actually happened in this database. The important honesty here
 * is that nothing on this page is a schedule: retraining is run by hand from
 * the research project, and the site reports the record it left rather than
 * implying a service that watches for new data.
 */
export default async function RetrainingPage() {
  const [models, datasets, runs, pathogens] = await Promise.all([
    getModelVersions(false),
    getDatasetVersions(),
    getPipelineRuns(200),
    getPathogens(),
  ]);

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;
  const trainRuns = runs.filter((r) => r.stage === "train");
  const predictRuns = runs.filter((r) => r.stage === "predict");
  const active = models.filter((m) => m.status === "ACTIVE");
  const superseded = models.filter((m) => m.status !== "ACTIVE");

  // Generations per pathogen: how many times this pathogen has been retrained.
  const generations = pathogens.map((p) => ({
    key: p.key,
    label: p.label,
    versions: models.filter((m) => m.pathogenKey === p.key),
    activeVersion: models.find((m) => m.pathogenKey === p.key && m.status === "ACTIVE") ?? null,
  }));

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "System", "Retraining"]} />
      <PageHeader
        eyebrow="System"
        title="Retraining"
        lede="When the models are rebuilt, how a new one takes over from an old one, and what this database records having happened."
      />

      <Section title="What has happened" note="counted from the registry and the run log">
        <MetricGrid>
          <KPI
            value={num(trainRuns.length)}
            label="Training runs recorded"
            source="pipeline_runs WHERE stage = 'train'"
          />
          <KPI
            value={num(predictRuns.length)}
            label="Inference runs recorded"
            source="pipeline_runs WHERE stage = 'predict'"
          />
          <KPI
            value={num(models.length)}
            label="Model versions in the registry"
            source="COUNT(*) in model_versions"
          />
          <KPI
            value={num(active.length)}
            label="Currently ACTIVE"
            source="model_versions WHERE status = 'ACTIVE'"
          />
          <KPI
            value={num(superseded.length)}
            label="Superseded, rejected or archived"
            source="model_versions WHERE status <> 'ACTIVE'"
          />
          <KPI
            value={num(datasets.length)}
            label="Dataset versions built"
            source="COUNT(*) in dataset_versions"
          />
        </MetricGrid>
      </Section>

      <Section title="The rule" note="what causes what">
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-3">
          <article className="bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              A new medicine appears
            </p>
            <h3 className="m-0 mt-2 font-display text-[15px] font-semibold text-ink">
              Inference only
            </h3>
            <p className="m-0 mt-2 max-w-[44ch] text-[13px] leading-relaxed text-ink-2">
              A new approved product brings chemistry, not labels. It is standardised,
              featurised and scored by the existing models. Nothing about the models
              changes, because nothing new has been learned.
            </p>
          </article>
          <article className="bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              New labelled bioactivity appears
            </p>
            <h3 className="m-0 mt-2 font-display text-[15px] font-semibold text-ink">
              Retraining evaluation
            </h3>
            <p className="m-0 mt-2 max-w-[44ch] text-[13px] leading-relaxed text-ink-2">
              New measurements change what &ldquo;active&rdquo; looks like, so a dataset
              version is rebuilt, candidates are trained, and the registry compares them
              against the model in service.
            </p>
          </article>
          <article className="bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              A candidate wins
            </p>
            <h3 className="m-0 mt-2 font-display text-[15px] font-semibold text-ink">
              Promotion, then re-inference
            </h3>
            <p className="m-0 mt-2 max-w-[44ch] text-[13px] leading-relaxed text-ink-2">
              Promotion is decided on prevalence-adjusted PR-AUC on the validation split,
              with absolute floors and a margin. The old version is archived and every
              prediction is recomputed, because a prediction belongs to a model version.
            </p>
          </article>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <WarningCallout title="This is not a scheduler">
            Nothing here runs on its own. Retraining is started by hand in the research
            project, and this page reports the record those runs left behind. A stale
            figure on this page means the stage has not been run, not that the system
            decided it was unnecessary.
          </WarningCallout>
          <LimitationCallout title="Why every prediction is recomputed">
            A prediction is stored per model version, so a retrain adds a generation
            rather than replacing one. Every query on this site joins the ACTIVE model, so
            a medicine cannot appear twice with two probabilities —{" "}
            <Link href="/models">Models &amp; Dataset</Link> shows which version is
            serving.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Generations by pathogen" note="what has been retrained, and how often">
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2 xl:grid-cols-4">
          {generations.map((g) => (
            <article key={g.key} className="bg-raised p-5">
              <h3 className="m-0 font-display text-[15px] font-semibold text-ink">{g.label}</h3>
              <p className="m-0 mt-3 font-mono text-[22px] tabular-nums leading-none text-ink">
                {num(g.versions.length)}
              </p>
              <p className="m-0 mt-2 text-[12px] leading-snug text-ink-2">
                model versions recorded
              </p>
              <p className="m-0 mt-3 border-t border-rule-soft pt-2 font-mono text-[11px] text-ink">
                {g.activeVersion?.modelVersion ?? "no ACTIVE model"}
              </p>
              <p className="m-0 mt-1 font-mono text-[10px] text-muted">
                {g.activeVersion ? `trained ${g.activeVersion.trainingDate.slice(0, 10)}` : "—"}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Version history" note="newest first, per pathogen">
        <TableWrap label="Model version history">
          <thead>
            <tr>
              <Th width="20%">Version</Th>
              <Th width="14%">Pathogen</Th>
              <Th width="12%">Trained</Th>
              <Th width="12%">Status</Th>
              <Th width="42%">Why it is in that state</Th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <Tr key={model.modelVersion}>
                <Td mono className="text-[11px]">
                  {model.modelVersion}
                </Td>
                <Td>{labelFor(model.pathogenKey)}</Td>
                <Td mono className="text-[11px]">
                  {model.trainingDate.slice(0, 10)}
                </Td>
                <Td mono className="text-[11px]">
                  {model.status}
                </Td>
                <Td className="text-[12px] leading-relaxed">
                  {orDash(model.selectionReason)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Training runs" note="from the run log">
        <TableWrap label="Training runs">
          <thead>
            <tr>
              <Th width="24%">Run</Th>
              <Th width="20%">Started</Th>
              <Th align="right" width="16%">
                Duration
              </Th>
              <Th align="right" width="16%">
                Records
              </Th>
              <Th width="12%">Errors</Th>
              <Th width="12%">Status</Th>
            </tr>
          </thead>
          <tbody>
            {trainRuns.map((run) => (
              <Tr key={run.runId}>
                <Td mono className="text-[11px]">
                  {run.runId}
                </Td>
                <Td mono className="text-[11px]">
                  {run.startedAt.slice(0, 16).replace("T", " ")}
                </Td>
                <Td align="right" mono>
                  {run.durationSeconds === null ? "—" : `${run.durationSeconds.toFixed(1)}s`}
                </Td>
                <Td align="right" mono>
                  {num(run.recordsProcessed)}
                </Td>
                <Td mono className="text-[11px]">
                  {run.errorCount > 0 ? num(run.errorCount) : "—"}
                </Td>
                <Td mono className="text-[11px]">
                  {run.status}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>
    </Page>
  );
}
