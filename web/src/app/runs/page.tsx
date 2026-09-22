import { Pagination, TableWrap, Td, Th, Tr } from "@/components/data";
import {
  Breadcrumb,
  LimitationCallout,
  Page,
  PageHeader,
  Section,
  num,
  orDash,
} from "@/components/primitives";
import { getPipelineErrors } from "@/lib/queries/analysis";
import { getPipelineRuns } from "@/lib/queries/core";
import { numberParam, type RawSearchParams } from "@/lib/url";

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

const PATH = "/runs";

/**
 * Run History.
 *
 * Every recorded execution, newest first, including the ones that failed.
 * A run log that only shows successes is a marketing surface; this one is here
 * so that a figure elsewhere on the site can be traced to the run that produced
 * it, whatever state that run ended in.
 */
export default async function RunsPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;
  const page = Math.max(1, numberParam(params, "page") ?? 1);
  const pageSize = 25;

  const [allRuns, errors] = await Promise.all([getPipelineRuns(500), getPipelineErrors(25)]);
  const runs = allRuns.slice((page - 1) * pageSize, page * pageSize);

  const failed = allRuns.filter((r) => r.status !== "ok" && r.status !== "success").length;

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "System", "Run History"]} />
      <PageHeader
        eyebrow="System"
        title="Run History"
        lede="Every pipeline execution this database has recorded, with its counts, its duration and its outcome."
        aside={
          <dl className="m-0 text-right">
            <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              Recorded runs
            </dt>
            <dd className="m-0 font-mono text-[12px] text-ink">{num(allRuns.length)}</dd>
          </dl>
        }
      />

      <Section title="Runs" note={`${num(failed)} did not finish with a success status`}>
        <TableWrap label="Pipeline runs">
          <thead>
            <tr>
              <Th width="18%">Run</Th>
              <Th width="10%">Stage</Th>
              <Th width="14%">Started</Th>
              <Th align="right" width="10%">
                Duration
              </Th>
              <Th align="right" width="12%">
                Processed
              </Th>
              <Th align="right" width="10%">
                New
              </Th>
              <Th align="right" width="10%">
                Skipped
              </Th>
              <Th align="right" width="8%">
                Errors
              </Th>
              <Th width="8%">Status</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Tr key={run.runId}>
                <Td mono className="text-[11px]">
                  {run.runId}
                </Td>
                <Td mono className="text-[11px]">
                  {run.stage}
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
                <Td align="right" mono>
                  {num(run.recordsNew)}
                </Td>
                <Td align="right" mono>
                  {num(run.recordsSkipped)}
                </Td>
                <Td align="right" mono>
                  {run.errorCount > 0 ? num(run.errorCount) : "—"}
                </Td>
                <Td mono className="text-[11px]">
                  {run.status}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>

        <Pagination
          page={page}
          pageSize={pageSize}
          total={allRuns.length}
          path={PATH}
          params={params}
          unit="runs"
        />
      </Section>

      <Section title="Most recent errors">
        {errors.length === 0 ? (
          <LimitationCallout title="No errors recorded">
            Nothing in <span className="font-mono">pipeline_errors</span> for this snapshot.
          </LimitationCallout>
        ) : (
          <TableWrap label="Recent pipeline errors">
            <thead>
              <tr>
                <Th width="18%">Run</Th>
                <Th width="12%">Stage</Th>
                <Th width="20%">Subject</Th>
                <Th width="36%">Message</Th>
                <Th width="14%">When</Th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error, index) => (
                <Tr key={`${error.runId}-${index}`}>
                  <Td mono className="text-[11px]">
                    {error.runId}
                  </Td>
                  <Td mono className="text-[11px]">
                    {error.stage}
                  </Td>
                  <Td mono className="break-all text-[11px]">
                    {orDash(error.subject)}
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

      <Section title="Reading a run">
        <div className="grid gap-4 lg:grid-cols-2">
          <LimitationCallout title="Counts are of records, not findings">
            &ldquo;Processed&rdquo; is how many rows a stage handled. It says nothing about
            what those rows mean, and a large number is not a result.
          </LimitationCallout>
          <LimitationCallout title="Skipped is not failed">
            A skipped record was deliberately not reprocessed — usually because it was
            already up to date. It is not an error, and it is not a record that was
            dropped.
          </LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}
