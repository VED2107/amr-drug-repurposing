import Link from "next/link";

import { TabStrip, TableWrap, Td, Th, Tr } from "@/components/data";
import {
  Breadcrumb,
  KPI,
  LimitationCallout,
  MetricGrid,
  Page,
  PageHeader,
  Section,
  num,
  orDash,
} from "@/components/primitives";
import { getBestPoses, getDockingCoverage } from "@/lib/queries/analysis";
import { getCoverageSummary, getDockingRuns, getDockingTargets, getPathogens } from "@/lib/queries/core";
import { TARGET_RESISTANCE_RELATION } from "@/lib/content";
import { DOCKING_SCREENING_TARGET_KCAL_MOL, DOCKING_TARGET_LABEL } from "@/lib/science";
import { firstValue, type RawSearchParams } from "@/lib/url";

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

const PATH = "/docking";

/**
 * Docking & 3D.
 *
 * Docking is the stage most likely to be over-read, so this page is built
 * around three statements: what was docked, against which structure, and what a
 * score does not mean. The "3D" here is the receptor and the search box that
 * produced the pose — the coordinates themselves live in the pipeline's output
 * files, and the page says so rather than showing a viewer with nothing in it.
 */
export default async function DockingPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;

  const [targets, runs, coverage, library, pathogens] = await Promise.all([
    getDockingTargets(),
    getDockingRuns(),
    getDockingCoverage(DOCKING_SCREENING_TARGET_KCAL_MOL),
    getCoverageSummary(),
    getPathogens(),
  ]);

  const targetParam = firstValue(params, "target");
  const selected = targets.find((t) => t.targetKey === targetParam) ?? null;
  const poses = await getBestPoses({ targetKey: selected?.targetKey, limit: 25 });

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;
  const dockedPercent =
    library.approvedMedicines > 0
      ? (library.dockedMedicines / library.approvedMedicines) * 100
      : null;

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Evidence", "Docking & 3D"]} />
      <PageHeader
        eyebrow="Evidence"
        title="Docking & 3D"
        lede="Every stored pose, the receptor it was computed against, and the search box it was computed in."
        aside={
          <dl className="m-0 text-right">
            <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              {DOCKING_TARGET_LABEL}
            </dt>
            <dd className="m-0 font-mono text-[12px] text-ink">
              {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol
            </dd>
          </dl>
        }
      />

      <Section title="Coverage" note="what has and has not been docked">
        <MetricGrid>
          <KPI
            value={`${num(library.dockedMedicines)} / ${num(library.approvedMedicines)}`}
            label={`Medicines with at least one stored pose${dockedPercent === null ? "" : ` · ${dockedPercent.toFixed(1)}% of the library`}`}
          />
          <KPI
            value={num(coverage.poses)}
            label="Stored poses"
          />
          <KPI
            value={num(coverage.ligandTargetPairs)}
            label="Ligand–target pairs docked"
          />
          <KPI
            value={num(coverage.targets)}
            label="Prepared receptors"
          />
          <KPI
            value={num(coverage.runs)}
            label="Docking runs recorded"
          />
          <KPI
            value={num(coverage.atOrBelowTarget)}
            label={`Pairs whose best pose reaches ${DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol`} note="best pose per medicine and target"
          />
        </MetricGrid>

        <div className="mt-6">
          <LimitationCallout title="The remainder is not a negative result">
            The medicines without a pose are <strong>not yet docked</strong>. Nothing has
            been computed for them, which is different from a computation that came back
            unfavourable, and different again from evidence of no effect.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Targets" note="one receptor per pathogen">
        <div className="mb-4">
          <LimitationCallout title="A docking target is not a resistance mechanism">
            Each pathogen here is known for a particular resistance mechanism, and each
            has one prepared receptor. For two of the four they are not the same protein.
            A receptor was chosen because its structure defines a binding site
            unambiguously and the enzyme is a validated antibacterial target — not because
            it is what makes the organism resistant. Each card says which case it is.
          </LimitationCallout>
        </div>
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2">
          {targets.map((target) => (
            <article key={target.targetKey} className="bg-raised p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 font-display text-[16px] font-semibold text-ink">
                  {target.name}
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {labelFor(target.pathogenKey)}
                </span>
              </div>
              <dl className="m-0 mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-rule-soft pt-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Gene
                </dt>
                <dd className="m-0 font-mono text-[12px] text-ink">{orDash(target.gene)}</dd>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Structure
                </dt>
                <dd className="m-0 font-mono text-[12px] text-ink">
                  {target.structureUrl ? (
                    <a href={target.structureUrl} rel="noreferrer noopener" target="_blank">
                      PDB {target.pdbId}
                    </a>
                  ) : (
                    `PDB ${target.pdbId}`
                  )}{" "}
                  · chain {target.chain}
                </dd>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  UniProt
                </dt>
                <dd className="m-0 font-mono text-[12px] text-ink">{orDash(target.uniprot)}</dd>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Site
                </dt>
                <dd className="m-0 font-mono text-[12px] text-ink">
                  {target.siteMode}
                  {target.siteReference ? ` · ${target.siteReference}` : ""}
                </dd>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Status
                </dt>
                <dd className="m-0 font-mono text-[12px] text-ink">{target.status}</dd>
              </dl>
              {(() => {
                const relation = TARGET_RESISTANCE_RELATION[target.targetKey];
                if (!relation) return null;
                return (
                  <div
                    className="mt-3 border-l-2 pl-3"
                    style={{
                      borderColor: relation.isResistanceMechanism
                        ? "var(--color-experimental)"
                        : "var(--color-none)",
                    }}
                  >
                    <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                      {relation.isResistanceMechanism
                        ? "This receptor is the resistance mechanism"
                        : "This receptor is not the resistance mechanism"}
                    </p>
                    <p className="m-0 mt-1 max-w-[60ch] text-[12px] leading-relaxed text-ink-2">
                      {relation.note}
                    </p>
                  </div>
                );
              })()}
              {target.selectionNotes ? (
                <p className="m-0 mt-3 max-w-[60ch] text-[12px] leading-relaxed text-muted">
                  {target.selectionNotes}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </Section>

      <Section title="Best pose per ligand and target" note="an ordering, not a ranking">
        <TabStrip
          label="Filter by target"
          param="target"
          path={PATH}
          params={params}
          current={selected?.targetKey ?? ""}
          options={[
            { value: "", label: "All targets", note: `${num(coverage.ligandTargetPairs)} pairs` },
            ...targets.map((t) => ({
              value: t.targetKey,
              label: t.gene ?? t.targetKey,
              note: labelFor(t.pathogenKey),
            })),
          ]}
        />

        <div className="mt-5">
          <TableWrap label="Best docking poses">
            <thead>
              <tr>
                <Th width="30%">Medicine</Th>
                <Th width="18%">Target</Th>
                <Th width="16%">Pathogen</Th>
                <Th align="right" width="18%">
                  Best score
                </Th>
                <Th width="18%">Run</Th>
              </tr>
            </thead>
            <tbody>
              {poses.map((pose) => (
                <Tr key={`${pose.moleculeId}-${pose.targetKey}`}>
                  <Td>
                    <Link
                      href={`/medicines/${encodeURIComponent(pose.moleculeId)}`}
                      transitionTypes={["nav-forward"]}
                      className="inline-block min-h-6 py-1 font-display text-[13px] font-semibold text-ink no-underline"
                    >
                      {pose.genericName ?? pose.moleculeId}
                    </Link>
                  </Td>
                  <Td mono className="text-[11px]">
                    {pose.targetKey}
                  </Td>
                  <Td>{labelFor(pose.pathogenKey)}</Td>
                  <Td align="right" mono>
                    {pose.score.toFixed(3)}
                    <span className="ml-1 text-[10px] text-muted">kcal/mol</span>
                  </Td>
                  <Td mono className="text-[11px] text-muted">
                    {pose.runId}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </Section>

      <Section title="Runs" note="every docking run recorded, including failures">
        <TableWrap label="Docking runs">
          <thead>
            <tr>
              <Th width="18%">Run</Th>
              <Th width="14%">Target</Th>
              <Th width="16%">Engine</Th>
              <Th align="right" width="10%">
                Ligands
              </Th>
              <Th align="right" width="10%">
                Succeeded
              </Th>
              <Th align="right" width="10%">
                Failed
              </Th>
              <Th width="12%">Status</Th>
              <Th width="10%">Started</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Tr key={run.runId}>
                <Td mono className="text-[11px]">
                  {run.runId}
                </Td>
                <Td mono className="text-[11px]">
                  {run.targetKey}
                </Td>
                <Td mono className="text-[11px]">
                  {run.engine}
                  {run.engineVersion ? ` ${run.engineVersion}` : ""}
                </Td>
                <Td align="right" mono>
                  {orDash(run.nLigands)}
                </Td>
                <Td align="right" mono>
                  {orDash(run.nSucceeded)}
                </Td>
                <Td align="right" mono>
                  {orDash(run.nFailed)}
                </Td>
                <Td mono className="text-[11px]">
                  {run.status}
                </Td>
                <Td mono className="text-[11px]">
                  {run.startedAt.slice(0, 10)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        {coverage.failedPoses > 0 ? (
          <p className="m-0 mt-3 font-mono text-[11px] text-muted">
            {num(coverage.failedPoses)} pose records carry a non-ok status and are excluded
            from every score above.
          </p>
        ) : null}
      </Section>

      <Section title="What a docking score is">
        <div className="grid gap-4 lg:grid-cols-3">
          <LimitationCallout title="An estimate of fit">
            AutoDock Vina scores how well a flexible ligand sits in a rigid receptor
            pocket, in kcal/mol, with more negative meaning a better-scoring pose. It is a
            calculation about geometry and an empirical function — not a measurement, and
            not proof that binding occurs.
          </LimitationCallout>
          <LimitationCallout title="The threshold is ours">
            {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol is the value this
            project screens at. It is not a universal binding cutoff, and a medicine on
            either side of it has not thereby been shown to do anything.
          </LimitationCallout>
          <LimitationCallout title="What the model of the receptor leaves out">
            Receptors are rigid here and cofactors are not modelled. A pose is one
            plausible arrangement under those simplifications, which is why several poses
            per ligand are stored rather than one answer.
          </LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}
