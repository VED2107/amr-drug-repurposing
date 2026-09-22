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

export const revalidate = 300;

const PATH = "/explorer";

/** Conditions a reader is likely to try first: the four with a model, named. */
const MODELLED_STARTERS = [
  "MRSA",
  "Escherichia coli infection",
  "Klebsiella pneumoniae infection",
  "Tuberculosis",
];

/**
 * Medicine × Disease.
 *
 * The question this page answers is "could this medicine be relevant to this
 * condition?", and the answer is always a rung plus what that rung does not
 * establish. Two rules do the work:
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
      <Breadcrumb trail={["Dashboard", "Explore", "Medicine × Disease"]} />
      <PageHeader
        eyebrow="Explore"
        title="Medicine × Disease"
        lede="Pair one medicine with one condition and see which kind of evidence exists for that pairing — and, just as importantly, which kinds do not."
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
              hint="Any condition. Only the four modelled bacteria can produce a probability."
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
              className="inline-flex min-h-11 items-center rounded-card border border-ink bg-ink px-4 font-display text-[13px] font-semibold text-paper"
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
                Conditions with a model
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
            {modelled === null ? (
              <WarningCallout title="No model exists for this condition">
                {NO_MODEL_NOTICE}
              </WarningCallout>
            ) : (
              <div className="border border-rule bg-raised p-5">
                <p className="m-0 mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  This condition matches the {labelFor(modelled)} model
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
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                      Lab measurements
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
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                      Best docking pose
                    </dt>
                    <dd className="m-0 mt-1 font-mono text-[13px] text-ink">
                      {evidence.bestDocking?.scoreKcalMol == null
                        ? "not yet docked"
                        : `${evidence.bestDocking.scoreKcalMol.toFixed(3)} kcal/mol`}
                    </dd>
                  </div>
                  <div className="bg-raised p-4">
                    <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                      Studies naming this condition
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
                ["Prediction", evidence.prediction ? `${evidence.prediction.probability} · ${evidence.prediction.modelVersion}` : "none"],
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
