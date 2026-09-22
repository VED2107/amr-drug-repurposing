import { TableWrap, Td, Th, Tr } from "@/components/data";
import {
  Breadcrumb,
  KPI,
  LimitationCallout,
  MetricGrid,
  Page,
  PageHeader,
  ProvenanceBlock,
  Section,
  WarningCallout,
  num,
  orDash,
} from "@/components/primitives";
import { getBenchmarks } from "@/lib/queries/analysis";
import { getDatasetVersions, getModelVersions, getPathogens } from "@/lib/queries/core";
import { RESISTANCE_LIMITATION } from "@/lib/science";
import { FEATURE_VERSION_GLOSS, MODEL_TYPE_GLOSS } from "@/lib/content";

export const revalidate = 300;

/** Metrics worth showing, in the order they should be read. */
const METRIC_ORDER: { key: string; label: string; digits: number }[] = [
  { key: "pr_auc_normalized", label: "Prevalence-adjusted PR-AUC", digits: 3 },
  { key: "pr_auc", label: "PR-AUC", digits: 3 },
  { key: "positive_prevalence", label: "Positive prevalence", digits: 3 },
  { key: "roc_auc", label: "ROC-AUC", digits: 3 },
  { key: "mcc", label: "Matthews correlation", digits: 3 },
  { key: "f1", label: "F1", digits: 3 },
  { key: "precision", label: "Precision", digits: 3 },
  { key: "recall", label: "Recall (sensitivity)", digits: 3 },
  { key: "specificity", label: "Specificity", digits: 3 },
  { key: "brier_score", label: "Brier score", digits: 3 },
];

function metric(
  metrics: Record<string, number> | null,
  key: string,
  digits = 3,
): string {
  const value = metrics?.[key];
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

/**
 * Models & Dataset.
 *
 * The registry as it stands: which model serves each pathogen, on which
 * dataset, why it was promoted, and what it was measured against. Two things
 * this page refuses to do — report a metric without the split it came from, and
 * hide the candidates that lost.
 */
export default async function ModelsPage() {
  const [active, all, datasets, benchmarks, pathogens] = await Promise.all([
    getModelVersions(true),
    getModelVersions(false),
    getDatasetVersions(),
    getBenchmarks(40),
    getPathogens(),
  ]);

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;
  const byStatus = all.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "System", "Models & Dataset"]} />
      <PageHeader
        eyebrow="System"
        title="Models & Dataset"
        lede="Which model is in service for each pathogen, the dataset it was trained on, and the numbers it was promoted on."
      />

      <Section title="Registry" note={`${num(all.length)} model versions recorded`}>
        <MetricGrid>
          <KPI
            value={num(active.length)}
            label="ACTIVE — serving predictions"
            source="model_versions WHERE status = 'ACTIVE'"
          />
          <KPI
            value={num(byStatus.CANDIDATE ?? 0)}
            label="CANDIDATE — trained, not promoted"
            source="model_versions WHERE status = 'CANDIDATE'"
          />
          <KPI
            value={num((byStatus.ARCHIVED ?? 0) + (byStatus.REJECTED ?? 0))}
            label="ARCHIVED or REJECTED"
            source="model_versions by status"
          />
          <KPI
            value={num(datasets.length)}
            label="Dataset versions"
            source="COUNT(*) in dataset_versions"
          />
          <KPI
            value={orDash(active[0]?.datasetVersion ?? null)}
            label="Dataset behind the ACTIVE models"
            source="model_versions.dataset_version"
          />
          <KPI
            value={orDash(active[0]?.featureVersion ?? null)}
            label="Feature version"
            source="model_versions.feature_version"
          />
        </MetricGrid>
      </Section>

      <Section title="How the models work" note="from the identifiers recorded with each model">
        {(() => {
          const activeModel = active[0] ?? null;
          const typeGloss = activeModel?.modelType
            ? MODEL_TYPE_GLOSS[activeModel.modelType]
            : undefined;
          const featureGloss = activeModel?.featureVersion
            ? FEATURE_VERSION_GLOSS[activeModel.featureVersion]
            : undefined;
          if (!typeGloss && !featureGloss) return null;
          return (
            <div className="grid gap-px border border-rule bg-rule md:grid-cols-2">
              {featureGloss ? (
                <article className="bg-raised p-5">
                  <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    Featurisation · {activeModel?.featureVersion}
                  </p>
                  <p className="m-0 mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
                    {featureGloss}
                  </p>
                </article>
              ) : null}
              {typeGloss ? (
                <article className="bg-raised p-5">
                  <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    Algorithm · {activeModel?.modelType}
                  </p>
                  <p className="m-0 mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
                    {typeGloss}
                  </p>
                </article>
              ) : null}
            </div>
          );
        })()}
      </Section>

      <Section title="In service" note="one model per pathogen">
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2">
          {active.map((model) => (
            <article key={model.modelVersion} className="bg-raised p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 font-display text-[16px] font-semibold text-ink">
                  {labelFor(model.pathogenKey)}
                </h3>
                <span className="font-mono text-[11px] text-ink">{model.modelVersion}</span>
              </div>

              <dl className="m-0 mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-rule-soft pt-3">
                {METRIC_ORDER.filter((m) => model.metrics?.[m.key] !== undefined).map((m) => (
                  <div key={m.key} className="contents">
                    <dt className="text-[12px] text-ink-2">{m.label}</dt>
                    <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">
                      {metric(model.metrics, m.key, m.digits)}
                    </dd>
                  </div>
                ))}
                <div className="contents">
                  <dt className="text-[12px] text-ink-2">Train / validation / test</dt>
                  <dd className="m-0 font-mono text-[12px] tabular-nums text-ink">
                    {num(model.nTrain)} / {num(model.nValidation)} / {num(model.nTest)}
                  </dd>
                </div>
                <div className="contents">
                  <dt className="text-[12px] text-ink-2">Split method</dt>
                  <dd className="m-0 font-mono text-[12px] text-ink">
                    {orDash(model.splitMethod)}
                  </dd>
                </div>
              </dl>

              {model.selectionReason ? (
                <p className="m-0 mt-3 max-w-[60ch] border-l-2 border-rule-strong pl-3 text-[12px] leading-relaxed text-ink-2">
                  {model.selectionReason}
                </p>
              ) : null}
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <LimitationCallout title="Why prevalence-adjusted PR-AUC">
            Raw PR-AUC rises with how common actives are in a test set, so it cannot be
            compared across pathogens. Promotion is decided on{" "}
            <span className="font-mono text-[12px]">(PR-AUC − prevalence) / (1 − prevalence)</span>
            , which removes that inflation. The unadjusted figure is shown next to it so
            both are visible.
          </LimitationCallout>
          <LimitationCallout title="What these metrics measure">
            They measure agreement with labelled laboratory activity for the species.{" "}
            {RESISTANCE_LIMITATION} A model that scores well has learned the labels it was
            given; it has not been shown to find medicines that work in patients.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Every model version" note="including the ones not in service">
        <TableWrap label="Model versions">
          <thead>
            <tr>
              <Th width="18%">Version</Th>
              <Th width="14%">Pathogen</Th>
              <Th width="12%">Type</Th>
              <Th width="12%">Status</Th>
              <Th align="right" width="14%">
                Adjusted PR-AUC
              </Th>
              <Th align="right" width="12%">
                ROC-AUC
              </Th>
              <Th width="18%">Dataset</Th>
            </tr>
          </thead>
          <tbody>
            {all.map((model) => (
              <Tr key={model.modelVersion}>
                <Td mono className="text-[11px]">
                  {model.modelVersion}
                </Td>
                <Td>{labelFor(model.pathogenKey)}</Td>
                <Td mono className="text-[11px]">
                  {model.modelType}
                  {model.isBaseline ? " · baseline" : ""}
                </Td>
                <Td mono className="text-[11px]">
                  {model.status}
                </Td>
                <Td align="right" mono>
                  {metric(model.metrics, "pr_auc_normalized")}
                </Td>
                <Td align="right" mono>
                  {metric(model.metrics, "roc_auc")}
                </Td>
                <Td mono className="text-[11px] text-muted">
                  {model.datasetVersion}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Benchmark candidates" note={`${num(benchmarks.length)} most recent evaluations`}>
        <TableWrap label="Benchmark candidates">
          <thead>
            <tr>
              <Th width="20%">Benchmark run</Th>
              <Th width="14%">Pathogen</Th>
              <Th width="16%">Model type</Th>
              <Th align="right" width="14%">
                Adjusted PR-AUC
              </Th>
              <Th align="right" width="12%">
                ROC-AUC
              </Th>
              <Th width="12%">Selected</Th>
              <Th width="12%">Baseline</Th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((row, index) => (
              <Tr key={`${row.benchmarkRunId}-${row.pathogenKey}-${row.modelType}-${index}`}>
                <Td mono className="text-[11px]">
                  {row.benchmarkRunId}
                </Td>
                <Td>{labelFor(row.pathogenKey)}</Td>
                <Td mono className="text-[11px]">
                  {row.modelType}
                </Td>
                <Td align="right" mono>
                  {metric(row.metrics, "pr_auc_normalized")}
                </Td>
                <Td align="right" mono>
                  {metric(row.metrics, "roc_auc")}
                </Td>
                <Td mono className="text-[11px]">
                  {row.selected ? "selected" : "—"}
                </Td>
                <Td mono className="text-[11px]">
                  {row.isBaseline ? "baseline" : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Datasets" note="what each version contains">
        <TableWrap label="Dataset versions">
          <thead>
            <tr>
              <Th width="30%">Version</Th>
              <Th align="right" width="14%">
                Records
              </Th>
              <Th align="right" width="14%">
                Compounds
              </Th>
              <Th align="right" width="12%">
                Pathogens
              </Th>
              <Th width="14%">Created</Th>
              <Th width="16%">Config hash</Th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <Tr key={d.datasetVersion}>
                <Td mono className="text-[11px]">
                  {d.datasetVersion}
                </Td>
                <Td align="right" mono>
                  {num(d.nRecords)}
                </Td>
                <Td align="right" mono>
                  {num(d.nCompounds)}
                </Td>
                <Td align="right" mono>
                  {num(d.nPathogens)}
                </Td>
                <Td mono className="text-[11px]">
                  {d.createdAt.slice(0, 10)}
                </Td>
                <Td mono className="text-[11px] text-muted">
                  {orDash(d.configHash)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>

        <div className="mt-6">
          <WarningCallout title="A dataset version identifies membership, not the split">
            The version id hashes which records are in the dataset. Each training run
            rewrites the train/validation/test assignment, so two models sharing a dataset
            version were not necessarily evaluated on the same partition. Where that
            mattered, the promotion record says so in its selection reason.
          </WarningCallout>
        </div>
      </Section>

      <Section title="Provenance">
        <ProvenanceBlock
          rows={[
            ["ACTIVE models", active.map((m) => m.modelVersion).join(" · ") || "none"],
            ["Dataset", active[0]?.datasetVersion ?? null],
            ["Feature version", active[0]?.featureVersion ?? null],
            ["Validation", active[0]?.validationMethod ?? null],
            ["Split", active[0]?.splitMethod ?? null],
            [
              "Library versions",
              active[0]?.libraryVersions
                ? Object.entries(active[0].libraryVersions)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")
                : null,
            ],
          ]}
        />
      </Section>
    </Page>
  );
}
