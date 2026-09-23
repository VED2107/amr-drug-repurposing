import Link from "next/link";

import { SearchField } from "@/components/search/SearchField";

import { Field, TableWrap, Td, Th, Tr } from "@/components/data";
import { ActivityIndicator } from "@/components/evidence/ActivityIndicator";
import { EvidenceLadder } from "@/components/evidence/EvidenceIndicator";
import {
  Breadcrumb,
  EmptyState,
  LimitationCallout,
  Page,
  PageHeader,
  ProvenanceBlock,
  Section,
  WarningCallout,
  num,
  orDash,
} from "@/components/primitives";
import { getEvidence, getPathogens } from "@/lib/queries/core";
import {
  findMoleculeIdByGenericName,
  getConditionsForMolecule,
} from "@/lib/queries/medicines";
import { searchMedicines } from "@/lib/queries/screening";
import {
  NO_MODEL_NOTICE,
  RESISTANCE_LIMITATION,
  matchModelledPathogen,
} from "@/lib/science";
import { firstValue, withParams, type RawSearchParams } from "@/lib/url";

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

const PATH = "/explorer";

/** Conditions a reader is likely to try first: the four with a model, named. */
const MODELLED_STARTERS = [
  "MRSA",
  "Escherichia coli infection",
  "Klebsiella pneumoniae infection",
  "Tuberculosis",
];

/**
 * Medicine × Condition (route `/explorer`; titled Medicine × Disease before).
 *
 * An evidence explorer, not a disease predictor. The question it answers is
 * "what evidence exists for this medicine and this condition?", and the answer
 * is always a rung plus what that rung does not establish. The random-forest
 * models predict activity against four organisms, not against conditions, so
 * the page shows the mapping explicitly (condition → organism → model) before
 * any number. Two rules do the work:
 *
 * - The percentage gate. A probability appears only when the condition matches
 *   one of the four modelled bacteria. Every other condition gets documented
 *   evidence and an explicit statement that no model exists — never a number.
 * - The five states stay apart. "Not yet checked" is not "no evidence found",
 *   and neither is "no effect".
 */
export default async function ExplorerPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;
  const medicineTerm = firstValue(params, "medicine")?.trim() ?? "";
  const condition = firstValue(params, "condition")?.trim() ?? "";

  const pathogens = await getPathogens();
  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;
  const fullNameFor = (key: string) => pathogens.find((p) => p.key === key)?.fullName ?? labelFor(key);
  const activeModelFor = (key: string) => pathogens.find((p) => p.key === key)?.activeModelVersion ?? null;

  // A medicine may be given as an InChIKey (from a link) or as a name (typed).
  let moleculeId: string | null = null;
  let candidates: { moleculeId: string; name: string; note: string }[] = [];
  if (medicineTerm) {
    if (/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(medicineTerm)) {
      moleculeId = medicineTerm;
    } else {
      const exact = await findMoleculeIdByGenericName(medicineTerm);
      if (exact) moleculeId = exact;
      else {
        candidates = await searchMedicines(medicineTerm, 8);
        if (candidates.length === 1) moleculeId = candidates[0].moleculeId;
      }
    }
  }

  const evidence =
    moleculeId && condition ? await getEvidence(moleculeId, condition) : null;
  const conditionOptions = moleculeId ? await getConditionsForMolecule(moleculeId, 12) : [];
  const modelled = condition ? matchModelledPathogen(condition) : null;

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Explore", "Medicine × Condition"]} />
      <PageHeader
        eyebrow="Explore"
        title="Medicine × Condition"
        lede="Explore the evidence available for one medicine and one condition: registered studies, lab measurements, docking and, only where the condition is caused by one of four modelled bacteria, an AI-predicted activity. This page does not predict whether a medicine treats a condition."
      />

      {/* --- The pairing ---------------------------------------------- */}
      <Section title="Choose a pairing">
        <form method="get" action={PATH} className="border border-rule bg-raised p-4 md:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Medicine" hint="Generic name, or an InChIKey from another page.">
              <SearchField
                name="medicine"
                source="medicines"
                label="Medicine"
                defaultValue={medicineTerm}
                placeholder="levoketoconazole"
              />
            </Field>
            <Field
              label="Condition"
              hint="Any condition can be explored for evidence. An AI-predicted activity appears only when the condition is caused by MRSA, E. coli, K. pneumoniae or M. tuberculosis."
            >
              <SearchField
                name="condition"
                source="conditions"
                label="Condition"
                defaultValue={condition}
                placeholder="tuberculosis"
                submitOnSelect
              />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
            <button
              type="submit"
              className="amr-btn"
            >
              Show the evidence
            </button>
            <Link
              href={PATH}
              className="inline-flex min-h-11 items-center rounded-card border border-rule-strong px-4 font-display text-[13px] text-ink no-underline"
            >
              Reset
            </Link>
          </div>
        </form>

        {candidates.length > 1 ? (
          <div className="mt-4 border border-rule bg-raised p-4">
            <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              Several medicines match that name
            </p>
            <ul className="m-0 flex flex-wrap gap-2 p-0">
              {candidates.map((hit) => (
                <li key={hit.moleculeId} className="list-none">
                  <Link
                    href={withParams(PATH, params, { medicine: hit.moleculeId })}
                    className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-display text-[13px] text-ink no-underline"
                  >
                    {hit.name}
                    <span className="ml-2 font-mono text-[10px] text-muted">{hit.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {moleculeId ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="border border-rule bg-raised p-4">
              <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                Conditions caused by a modelled bacterium
              </p>
              <ul className="m-0 flex flex-wrap gap-2 p-0">
                {MODELLED_STARTERS.map((name) => (
                  <li key={name} className="list-none">
                    <Link
                      href={withParams(PATH, params, { medicine: moleculeId, condition: name })}
                      className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-display text-[13px] text-ink no-underline"
                    >
                      {name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-rule bg-raised p-4">
              <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                Conditions this medicine has been studied for
              </p>
              {conditionOptions.length === 0 ? (
                <p className="m-0 text-[12px] leading-relaxed text-muted">
                  No registered study for this medicine names a condition in the loaded
                  snapshot.
                </p>
              ) : (
                <ul className="m-0 flex flex-wrap gap-2 p-0">
                  {conditionOptions.map((option) => (
                    <li key={option.name} className="list-none">
                      <Link
                        href={withParams(PATH, params, {
                          medicine: moleculeId,
                          condition: option.name,
                        })}
                        className="inline-flex min-h-11 items-center rounded-card border border-rule px-3 font-display text-[13px] text-ink no-underline"
                      >
                        {option.name}
                        <span className="ml-2 font-mono text-[10px] text-muted">
                          {num(option.studyCount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Section>

      {/* --- The answer ----------------------------------------------- */}
      {!moleculeId || !condition ? (
        <Section title="Evidence">
          <EmptyState title="Choose a medicine and a condition">
            Nothing is shown until both halves of the pairing are given. An empty result
            on this page would be a statement about evidence, and no such statement has
            been made yet. A <strong>medicine</strong> is an approved product; a{" "}
            <strong>condition</strong> is what a study was registered against. Only four
            conditions correspond to an organism this system has a model for.
          </EmptyState>
        </Section>
      ) : evidence === null ? (
        <Section title="Evidence">
          <EmptyState title="That medicine is not in the library">
            No approved product matching “{medicineTerm}” resolved to a structure in the
            loaded snapshot.
          </EmptyState>
        </Section>
      ) : (
        <>
          <Section
            title={`${evidence.medicineName} × ${evidence.condition}`}
            note={evidence.wasChecked ? "the registry was queried" : "never queried"}
          >
            <MappingChain
              condition={evidence.condition}
              organism={modelled === null ? null : fullNameFor(modelled)}
              modelVersion={modelled === null ? null : evidence.prediction?.modelVersion ?? activeModelFor(modelled)}
              hasPrediction={modelled !== null && evidence.prediction !== null}
            />
            {modelled === null ? (
              <WarningCallout title="No model exists for this condition">
                {NO_MODEL_NOTICE}
              </WarningCallout>
            ) : (
              <div className="border border-rule bg-raised p-5">
                <p className="m-0 mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-computational">
                  <span aria-hidden="true">▲ </span>Computational · model prediction for the organism
                </p>
                {/*
                  The condition and the organism are different things, and the
                  model only knows one of them. Saying so here is what stops the
                  number below being read as "how likely this medicine is to
                  treat the disease named in the box".
                */}
                <p className="m-0 mb-3 max-w-[68ch] text-[12px] leading-relaxed text-muted">
                  The value below is predicted antibacterial activity against{" "}
                  <em>{labelFor(modelled)}</em>, the organism. It is not a prediction
                  about {evidence.condition} as a clinical condition, about a patient, or
                  about treatment.
                </p>
                <ActivityIndicator
                  pathogenKey={modelled}
                  probability={evidence.prediction?.probability ?? null}
                  modelVersion={evidence.prediction?.modelVersion ?? null}
                  inTrainingData={evidence.prediction?.inTrainingData ?? null}
                  trainingSplit={evidence.prediction?.trainingSplit ?? null}
                />
              </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <EvidenceLadder active={evidence.rung} />
              <div className="flex flex-col gap-4">
                <dl className="m-0 grid gap-px border border-rule bg-rule sm:grid-cols-2">
                  <div className="bg-raised p-4">
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-experimental">
                      <span aria-hidden="true">■ </span>Lab measurements
                    </dt>
                    <dd className="m-0 mt-1 font-mono text-[13px] text-ink">
                      {evidence.measuredRecords === null
                        ? "not yet checked"
                        : evidence.measuredRecords > 0
                          ? `${num(evidence.measuredRecords)} labelled records`
                          : modelled === null
                            ? "not applicable without a modelled organism"
                            : "none recorded"}
                    </dd>
                  </div>
                  <div className="bg-raised p-4">
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-computational">
                      <span aria-hidden="true">▲ </span>Best docking pose
                    </dt>
                    <dd className="m-0 mt-1 font-mono text-[13px] text-ink">
                      {evidence.bestDocking?.scoreKcalMol == null
                        ? "not yet docked"
                        : `${evidence.bestDocking.scoreKcalMol.toFixed(3)} kcal/mol`}
                    </dd>
                  </div>
                  <div className="bg-raised p-4">
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-clinical">
                      <span aria-hidden="true">◆ </span>Studies naming this condition
                    </dt>
                    <dd className="m-0 mt-1 font-mono text-[13px] text-ink">
                      {!evidence.wasChecked
                        ? "not yet checked"
                        : evidence.trialCount > 0
                          ? num(evidence.trialCount)
                          : "no evidence found"}
                    </dd>
                  </div>
                  <div className="bg-raised p-4">
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                      Registry checked
                    </dt>
                    <dd className="m-0 mt-1 font-mono text-[13px] text-ink">
                      {orDash(evidence.checkedAt?.slice(0, 10) ?? null)}
                    </dd>
                  </div>
                </dl>

                <LimitationCallout title="What this pairing does not establish">
                  Nothing here says this medicine treats this condition. A study that
                  names the condition is a registration, a measurement is in vitro, and a
                  pose is geometry.
                </LimitationCallout>
              </div>
            </div>
          </Section>

          {evidence.trials.length > 0 ? (
            <Section title="Studies naming this condition" note="registrations, not results">
              <TableWrap label="Studies naming this condition">
                <thead>
                  <tr>
                    <Th width="40%">Study</Th>
                    <Th width="22%">Conditions</Th>
                    <Th width="10%">Phase</Th>
                    <Th width="16%">Status</Th>
                    <Th width="12%">Registry</Th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.trials.slice(0, 30).map((trial) => (
                    <Tr key={trial.nctId}>
                      <Td>{trial.briefTitle ?? trial.nctId}</Td>
                      <Td>{trial.conditions.length ? trial.conditions.join("; ") : "—"}</Td>
                      <Td mono>{orDash(trial.phase)}</Td>
                      <Td mono>{orDash(trial.overallStatus)}</Td>
                      <Td mono className="text-[11px]">
                        {trial.url ? (
                          <a href={trial.url} rel="noreferrer noopener" target="_blank">
                            {trial.nctId}
                          </a>
                        ) : (
                          trial.nctId
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </Section>
          ) : null}

          <Section title="Provenance">
            <ProvenanceBlock
              rows={[
                ["Medicine", `${evidence.medicineName} · ${evidence.moleculeId}`],
                ["Condition", evidence.condition],
                [
                  "Modelled pathogen",
                  modelled === null ? "none — no model covers this condition" : labelFor(modelled),
                ],
                [
                  "AI-predicted activity",
                  modelled === null
                    ? "none: no model covers this condition"
                    : evidence.prediction
                      ? `${evidence.prediction.probability} from ${evidence.prediction.modelVersion}, against ${fullNameFor(modelled)} (the organism, not the condition)`
                      : `no stored prediction for this medicine from the ${labelFor(modelled)} model`,
                ],
                ["Rung", evidence.rung],
                [
                  "Registry query",
                  evidence.wasChecked
                    ? `ClinicalTrials.gov · retrieved ${evidence.checkedAt?.slice(0, 10) ?? "date unrecorded"}`
                    : "never queried",
                ],
              ]}
            />
          </Section>
        </>
      )}

      <Section title="How a pairing is graded">
        <div className="grid gap-4 lg:grid-cols-2">
          <LimitationCallout title="The gate on probabilities">
            A probability requires a model, and models exist for MRSA, E. coli,
            K. pneumoniae and M. tuberculosis only. For anything else this page shows what
            is documented and says plainly that no model exists — there is no estimate,
            no extrapolation and no fallback number.
          </LimitationCallout>
          <LimitationCallout title="Species, not phenotype">{RESISTANCE_LIMITATION}</LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}

/**
 * How the chosen condition reaches a model, drawn before any number appears.
 *
 * The models know organisms, not conditions. Showing the chain (condition,
 * organism, model, result) is what stops "AI-predicted activity against
 * M. tuberculosis" being read as "chance this medicine treats tuberculosis",
 * and it makes the no-model case a visible dead end rather than a missing box.
 */
function MappingChain({
  condition,
  organism,
  modelVersion,
  hasPrediction,
}: {
  condition: string;
  organism: string | null;
  modelVersion: string | null;
  hasPrediction: boolean;
}) {
  const steps: { label: string; value: string; italic?: boolean; stop?: boolean }[] =
    organism === null
      ? [
          { label: "Condition", value: condition },
          { label: "Organism", value: "Not one of the four modelled bacteria", stop: true },
          { label: "Model", value: "None", stop: true },
          { label: "Result", value: "No AI-predicted activity is shown", stop: true },
        ]
      : [
          { label: "Condition", value: condition },
          { label: "Organism", value: organism, italic: true },
          { label: "Model", value: modelVersion ?? "No ACTIVE model", stop: modelVersion === null },
          {
            label: "Result",
            value: hasPrediction
              ? "AI-predicted activity against the organism"
              : "No stored prediction for this medicine",
            stop: !hasPrediction,
          },
        ];

  return (
    <ol
      aria-label="How this condition maps to a model"
      className="m-0 mb-5 grid list-none gap-px overflow-hidden rounded-card border border-rule bg-rule p-0 sm:grid-cols-2 lg:grid-cols-4"
    >
      {steps.map((step, i) => (
        <li key={step.label} className="min-w-0 bg-raised px-4 py-3">
          <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {i > 0 ? <span aria-hidden="true">→ </span> : null}
            {step.label}
          </p>
          <p
            className={`m-0 mt-1 break-words text-[14px] leading-snug ${step.italic ? "italic" : ""}`}
            style={{ color: step.stop ? "var(--color-rose)" : "var(--color-ink)" }}
          >
            {step.value}
          </p>
        </li>
      ))}
    </ol>
  );
}
