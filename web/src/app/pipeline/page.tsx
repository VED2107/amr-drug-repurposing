import { TableWrap, Td, Th, Tr } from "@/components/data";
import {
  Breadcrumb,
  LimitationCallout,
  Page,
  PageHeader,
  Section,
  num,
  orDash,
} from "@/components/primitives";
import { getDataSources, getPipelineErrors, getStageSummaries } from "@/lib/queries/analysis";
import { getModelVersions } from "@/lib/queries/core";
import { STAGES } from "@/lib/content";

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
 * Pipeline.
 *
 * The five stages, what each one has actually run, and what each one does not
 * establish. The stage cards carry a "proves / does not prove" pair because the
 * usual way a pipeline diagram misleads is by implying that passing through a
 * stage confers the authority of that stage.
 */
export default async function PipelinePage() {
  const [stages, sources, errors, activeModels] = await Promise.all([
    getStageSummaries(),
    getDataSources(),
    getPipelineErrors(20),
    getModelVersions(true),
  ]);

  const summaryFor = (name: string) =>
    stages.find((s) => s.stage.toLowerCase() === name.toLowerCase()) ?? null;

  // The narrative stage names and the pipeline's own stage keys are not the
  // same vocabulary; this maps one to the other without inventing a stage.
  const STAGE_KEYS: Record<string, string> = {
    COLLECT: "ingest",
    DECODE: "process",
    PREDICT: "train",
    VALIDATE: "dock",
    DELIVER: "predict",
  };

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "System", "Pipeline"]} />
      <PageHeader
        eyebrow="System"
        title="Pipeline"
        lede="Five stages from public data to a rendered figure, each one with the claim it supports and the claim it does not."
      />

      <Section title="The five stages">
        <ol className="m-0 grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-2 xl:grid-cols-5">
          {STAGES.map((stage) => {
            const key = STAGE_KEYS[stage.name];
            const run = key ? summaryFor(key) : null;
            return (
              <li key={stage.n} className="bg-raised p-5">
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

                <dl className="m-0 mt-4 border-t border-rule-soft pt-3">
                  <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    Recorded runs
                  </dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {run ? `${num(run.runs)} · ${run.lastStatus ?? "status unrecorded"}` : "none recorded"}
                  </dd>
                  {run?.lastRun ? (
                    <>
                      <dt className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                        Last run
                      </dt>
                      <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                        {run.lastRun.slice(0, 10)}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section id="new-medicines" title="How a new medicine is scored" note="the update worker">
        <p className="m-0 max-w-[72ch] text-[14px] leading-relaxed text-ink-2">
          When a medicine is newly approved, nobody types it in. The update worker — a
          container that holds the four trained models and nothing else — finds it in the
          public sources and scores it with the models already in service. The website shows
          it on the next page request, with no redeploy.
        </p>

        <ol className="m-0 mt-6 grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-2 xl:grid-cols-3">
          {NEW_MEDICINE_STEPS.map((step, i) => (
            <li key={step.title} className="bg-raised p-5">
              <p className="m-0 font-mono text-[11px] tabular-nums text-accent">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="m-0 mt-2 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {step.title}
              </h3>
              <p className="m-0 mt-2 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
              {step.title === "Scored" ? (
                <p className="m-0 mt-3 font-mono text-[11px] leading-[1.7] text-ink">
                  {activeModels.length > 0
                    ? activeModels.map((m) => m.modelVersion).join(" · ")
                    : "no ACTIVE model is published"}
                </p>
              ) : null}
            </li>
          ))}
        </ol>

        <dl className="m-0 mt-6 grid gap-x-10 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
          <div className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
            <dt className="text-muted">last new-medicine sweep</dt>
            <dd className="m-0 text-ink">{orDash(summaryFor("update")?.lastRun?.slice(0, 16).replace("T", " ") ?? null)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
            <dt className="text-muted">sweeps recorded</dt>
            <dd className="m-0 tabular-nums text-ink">{num(summaryFor("update")?.runs ?? 0)}</dd>
          </div>
        </dl>

        <div className="mt-6">
          <LimitationCallout title="What the worker does not do">
            It never retrains a model: a newly approved medicine is something to score, not
            something to learn from. It does not dock the medicine or query the clinical trial
            registry, so a new medicine appears as <strong>not yet docked</strong> and{" "}
            <strong>not yet checked</strong> until those stages are run — which is not the same
            as no evidence found. And its predictions are AI-predicted activity, like every
            other on this site: they do not show that the medicine treats anything.
          </LimitationCallout>
        </div>
      </Section>
      <Section title="Stages as the database records them" note="every stage that has ever run">
        <TableWrap label="Pipeline stages">
          <thead>
            <tr>
              <Th width="20%">Stage</Th>
              <Th align="right" width="12%">
                Runs
              </Th>
              <Th align="right" width="20%">
                Records processed
              </Th>
              <Th align="right" width="14%">
                Errors
              </Th>
              <Th width="18%">Last run</Th>
              <Th width="16%">Last status</Th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <Tr key={stage.stage}>
                <Td mono>{stage.stage}</Td>
                <Td align="right" mono>
                  {num(stage.runs)}
                </Td>
                <Td align="right" mono>
                  {num(stage.recordsProcessed)}
                </Td>
                <Td align="right" mono>
                  {stage.errors > 0 ? num(stage.errors) : "—"}
                </Td>
                <Td mono className="text-[11px]">
                  {stage.lastRun?.slice(0, 16).replace("T", " ") ?? "—"}
                </Td>
                <Td mono className="text-[11px]">
                  {orDash(stage.lastStatus)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Sources" note="where the data came from">
        {sources.length === 0 ? (
          <LimitationCallout title="No source record">
            The loaded snapshot carries no rows in <span className="font-mono">data_sources</span>.
          </LimitationCallout>
        ) : (
          <TableWrap label="Data sources">
            <thead>
              <tr>
                <Th width="24%">Source</Th>
                <Th width="16%">Version</Th>
                <Th align="right" width="14%">
                  Records
                </Th>
                <Th width="14%">Retrieved</Th>
                <Th width="32%">Notes</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <Tr key={`${source.name}-${source.retrievedAt}`}>
                  <Td>
                    {source.url ? (
                      <a href={source.url} rel="noreferrer noopener" target="_blank">
                        {source.name}
                      </a>
                    ) : (
                      source.name
                    )}
                  </Td>
                  <Td mono className="text-[11px]">
                    {orDash(source.sourceVersion)}
                  </Td>
                  <Td align="right" mono>
                    {num(source.recordCount)}
                  </Td>
                  <Td mono className="text-[11px]">
                    {source.retrievedAt.slice(0, 10)}
                  </Td>
                  <Td className="text-[12px]">{orDash(source.notes)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Errors" note="kept, not swallowed">
        {errors.length === 0 ? (
          <LimitationCallout title="No errors recorded">
            No stage recorded an error in this snapshot. That is a statement about what was
            logged, not a guarantee that every record was processed as intended.
          </LimitationCallout>
        ) : (
          <TableWrap label="Pipeline errors">
            <thead>
              <tr>
                <Th width="16%">Stage</Th>
                <Th width="20%">Subject</Th>
                <Th width="16%">Type</Th>
                <Th width="34%">Message</Th>
                <Th width="14%">When</Th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error, index) => (
                <Tr key={`${error.runId}-${index}`}>
                  <Td mono className="text-[11px]">
                    {error.stage}
                  </Td>
                  <Td mono className="break-all text-[11px]">
                    {orDash(error.subject)}
                  </Td>
                  <Td mono className="text-[11px]">
                    {orDash(error.errorType)}
                  </Td>
                  <Td className="text-[12px]">{orDash(error.message)}</Td>
                  <Td mono className="text-[11px]">
                    {error.createdAt.slice(0, 10)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </Page>
  );
}

/** The path a newly approved medicine takes, in the update worker's own order. */
const NEW_MEDICINE_STEPS: { title: string; body: string }[] = [
  {
    title: "Found",
    body: "The worker reads ChEMBL's approved molecules and the FDA Orange Book. A structure whose InChIKey is not yet published is new. A record without a structure is counted and skipped — never completed from somewhere else.",
  },
  {
    title: "Checked",
    body: "Before anything is scored, the worker proves it holds the production models: each model file must match its recorded checksum, and 20 published predictions must be reproduced exactly. If either fails, it stops and scores nothing.",
  },
  {
    title: "Standardised",
    body: "The structure goes through the same standardisation and the same Morgan fingerprint (radius 2, 1,024 bits) that produced every prediction already on this site.",
  },
  {
    title: "Scored",
    body: "The fingerprint is passed to the four ACTIVE models — one per modelled bacterium — giving four AI-predicted activity values, each labelled with the model version that produced it:",
  },
  {
    title: "Published",
    body: "The medicine, its approved products and its four predictions are written to the database together, one medicine at a time. Running the worker again adds nothing twice.",
  },
  {
    title: "Shown",
    body: "The write changes the data version every page is read at, so the next request shows the new medicine everywhere at once — in screening, in its own record and in the counts above.",
  },
];
