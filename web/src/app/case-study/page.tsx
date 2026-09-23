import Link from "next/link";

import { TableWrap, Td, Th, Tr } from "@/components/data";
import { ActivityIndicator } from "@/components/evidence/ActivityIndicator";
import { EvidenceIndicator } from "@/components/evidence/EvidenceIndicator";
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
import {
  getDockingForMolecule,
  getDockingTargets,
  getMedicineByMoleculeId,
  getModelVersions,
  getPathogens,
  getPredictionsForMolecule,
  getTrialsForMolecule,
  wasClinicallyChecked,
} from "@/lib/queries/core";
import {
  findMoleculeIdByGenericName,
  getMeasuredCountsByPathogen,
  getScaffoldNeighboursInTraining,
} from "@/lib/queries/medicines";
import {
  ACTIVITY_LABEL,
  DOCKING_SCREENING_TARGET_KCAL_MOL,
  RESISTANCE_LIMITATION,
  formatProbability,
} from "@/lib/science";

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

/** The worked example, and the held-out control it is read against. */
const SUBJECT = { name: "LEVOKETOCONAZOLE", pathogen: "mtb" as const };
const CONTROL = { name: "CIPROFLOXACIN", pathogen: "kpneumoniae" as const };

/**
 * Case Study.
 *
 * This page exists to be read carefully, so it is built the other way round
 * from a result write-up: the caveat comes first, then the four claims are
 * separated so they cannot be read as one accumulating argument, and the last
 * section is what the system does not establish.
 *
 * Every identifier and every figure is read from the database at render time.
 * That is not incidental — the design project this site's look comes from
 * carries a ChEMBL ID for this medicine that belongs to an unrelated drug, and
 * reading identifiers live is what keeps that mistake out of the interface.
 */
export default async function CaseStudyPage() {
  const [subjectId, controlId] = await Promise.all([
    findMoleculeIdByGenericName(SUBJECT.name),
    findMoleculeIdByGenericName(CONTROL.name),
  ]);

  if (!subjectId) {
    return (
      <Page>
        <Breadcrumb trail={["Dashboard", "Explore", "Case Study"]} />
        <PageHeader eyebrow="Explore" title="Case Study" />
        <EmptyState title="The case-study subject is not in this database">
          No approved product with the generic name {SUBJECT.name} resolved to a
          structure in the loaded snapshot, so there is nothing to show. The page is
          deliberately empty rather than illustrated with a stand-in.
        </EmptyState>
      </Page>
    );
  }

  const [
    medicine,
    predictions,
    docking,
    targets,
    trials,
    clinical,
    measured,
    neighbours,
    models,
    pathogens,
  ] = await Promise.all([
    getMedicineByMoleculeId(subjectId),
    getPredictionsForMolecule(subjectId),
    getDockingForMolecule(subjectId),
    getDockingTargets(),
    getTrialsForMolecule(subjectId),
    wasClinicallyChecked(subjectId),
    getMeasuredCountsByPathogen(subjectId),
    getScaffoldNeighboursInTraining(subjectId),
    getModelVersions(true),
    getPathogens(),
  ]);

  const controlPredictions = controlId ? await getPredictionsForMolecule(controlId) : [];
  const controlDocking = controlId ? await getDockingForMolecule(controlId) : [];
  const controlMeasured = controlId
    ? await getMeasuredCountsByPathogen(controlId)
    : {};

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;

  const prediction = predictions.find((p) => p.pathogenKey === SUBJECT.pathogen) ?? null;
  const model = models.find((m) => m.pathogenKey === SUBJECT.pathogen) ?? null;
  const target = targets.find((t) => t.pathogenKey === SUBJECT.pathogen) ?? null;
  const poses = docking.filter((d) => d.status === "ok" && d.scoreKcalMol !== null);
  const bestPose = poses[0] ?? null;
  const amrTrials = trials.filter((t) => t.amrRelated);
  const subjectMeasured = measured[SUBJECT.pathogen] ?? null;

  const controlPrediction =
    controlPredictions.find((p) => p.pathogenKey === CONTROL.pathogen) ?? null;
  const controlModel = models.find((m) => m.pathogenKey === CONTROL.pathogen) ?? null;
  const controlBest =
    controlDocking.find(
      (d) => d.pathogenKey === CONTROL.pathogen && d.status === "ok" && d.scoreKcalMol !== null,
    ) ?? null;

  const adjusted = (metrics: Record<string, number> | null) =>
    metrics && typeof metrics.pr_auc_normalized === "number"
      ? metrics.pr_auc_normalized.toFixed(3)
      : null;

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Explore", "Case Study"]} />
      <PageHeader
        eyebrow="Explore"
        title={`${medicine?.genericName ?? SUBJECT.name} × ${labelFor(SUBJECT.pathogen)}`}
        lede="One medicine followed through every stage of the system, with each stage's claim kept separate from the next."
        aside={
          <div className="text-right">
            <EvidenceIndicator value="computational" />
          </div>
        }
      />

      {/* The caveat is the first thing on the page, not a footnote. */}
      <div className="mb-10">
        <WarningCallout title="Read this before anything else">
          <p className="m-0">
            This is a <strong>retrospective computational case study, not a held-out
            discovery result</strong>. The medicine was chosen because the system produced
            an interesting set of records for it, the records were then assembled here,
            and nothing about that sequence tests whether the system can find something
            new. Nothing on this page establishes that {medicine?.genericName ?? SUBJECT.name}{" "}
            treats tuberculosis.
          </p>
        </WarningCallout>
      </div>

      {/* --- The subject ---------------------------------------------- */}
      <Section reveal title="The subject" note="identifiers read from the database">
        <dl className="m-0 grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Generic name", medicine?.genericName],
            ["Brand", medicine?.brandName],
            ["InChIKey", subjectId],
            ["ChEMBL", medicine?.chemblId],
            ["Approval source", medicine?.approvalSource],
            ["Approval date", medicine?.approvalDate],
            ["Dosage form", medicine?.dosageForm],
            ["Structure match", medicine?.matchMethod],
          ].map(([term, value]) => (
            <div key={term as string} className="bg-raised p-4">
              <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                {term}
              </dt>
              <dd className="m-0 mt-1 break-all font-mono text-[12px] text-ink">
                {orDash(value as string | null | undefined)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 mt-4 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
          The medicine is approved for Cushing&rsquo;s syndrome. That approval is the
          reason it is in this library at all, and it is not an approval for any
          antibacterial use.
        </p>
      </Section>

      {/* --- Claim 1: prediction --------------------------------------- */}
      <Section reveal title="1 · What the model predicted" note="a model output, nothing more">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="border border-rule bg-raised p-5">
            <ActivityIndicator
              pathogenKey={SUBJECT.pathogen}
              probability={prediction?.probability ?? null}
              modelVersion={prediction?.modelVersion ?? null}
              inTrainingData={prediction?.inTrainingData ?? null}
              trainingSplit={prediction?.trainingSplit ?? null}
            />
          </div>
          <div>
            <ProvenanceBlock
              rows={[
                ["Model", model?.modelVersion ?? null],
                ["Type", model?.modelType ?? null],
                ["Dataset", model?.datasetVersion ?? null],
                ["Split method", model?.splitMethod ?? null],
                ["Validation", model?.validationMethod ?? null],
                [
                  "Test set",
                  model?.nTest == null ? null : `${num(model.nTest)} molecules`,
                ],
                [
                  "Prevalence-adjusted PR-AUC",
                  adjusted(model?.metrics ?? null),
                ],
                ["Selection reason", model?.selectionReason ?? null],
              ]}
            />
          </div>
        </div>
        <div className="mt-5">
          <LimitationCallout title="What a probability of this kind is">
            A random forest reports how many of its trees voted that this chemistry
            resembles what the training data labelled active against{" "}
            {labelFor(SUBJECT.pathogen)}. {RESISTANCE_LIMITATION}
          </LimitationCallout>
        </div>
      </Section>

      {/* --- Claim 2: docking ------------------------------------------ */}
      <Section
        reveal
        title="2 · What the docking produced"
        note={`project screening target ${DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol`}
      >
        {bestPose === null || target === null ? (
          <LimitationCallout title="Not yet docked">
            No stored pose exists for this medicine against the{" "}
            {labelFor(SUBJECT.pathogen)} target in the loaded snapshot.
          </LimitationCallout>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
              <div className="border border-rule bg-raised p-5">
                <p
                  className="m-0 font-mono text-[28px] font-medium tabular-nums leading-none"
                  style={{ color: "var(--color-violet)" }}
                >
                  {bestPose.scoreKcalMol?.toFixed(3)}
                </p>
                <p className="m-0 mt-2 font-mono text-[11px] text-muted">
                  kcal/mol · best of {num(poses.length)} stored poses
                </p>
                <p className="m-0 mt-3 text-[13px] leading-relaxed text-ink-2">
                  Against {target.name} ({target.gene ?? "gene unrecorded"}), PDB{" "}
                  {target.pdbId} chain {target.chain}.
                </p>
              </div>
              <div>
                <ProvenanceBlock
                  rows={[
                    ["Target", `${target.name} · ${target.targetKey}`],
                    ["Structure", `PDB ${target.pdbId} · chain ${target.chain}`],
                    ["UniProt", target.uniprot],
                    ["Site definition", `${target.siteMode}${target.siteReference ? ` · ${target.siteReference}` : ""}`],
                    ["Run", bestPose.runId],
                    ["Why this target", target.selectionNotes],
                  ]}
                />
              </div>
            </div>

            <div className="mt-6">
              <TableWrap label="Stored poses">
                <thead>
                  <tr>
                    <Th align="right" width="14%">
                      Pose
                    </Th>
                    <Th align="right" width="22%">
                      Score
                    </Th>
                    <Th align="right" width="32%">
                      RMSD lower / upper
                    </Th>
                    <Th width="32%">Run</Th>
                  </tr>
                </thead>
                <tbody>
                  {poses.slice(0, 10).map((pose) => (
                    <Tr key={`${pose.runId}-${pose.poseRank}`}>
                      <Td align="right" mono>
                        {pose.poseRank}
                      </Td>
                      <Td align="right" mono>
                        {pose.scoreKcalMol?.toFixed(3)}{" "}
                        <span className="text-[10px] text-muted">kcal/mol</span>
                      </Td>
                      <Td align="right" mono>
                        {pose.rmsdLb === null ? "—" : pose.rmsdLb.toFixed(3)} /{" "}
                        {pose.rmsdUb === null ? "—" : pose.rmsdUb.toFixed(3)}
                      </Td>
                      <Td mono className="text-[11px] text-muted">
                        {pose.runId}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <div className="mt-5">
              <LimitationCallout title="What a pose is not">
                The receptor is rigid, the cofactor is not modelled, and the score is an
                estimate of fit rather than a measurement of binding. A pose below this
                project&rsquo;s screening target is a reason to look further, not evidence
                of an interaction.
              </LimitationCallout>
            </div>
          </>
        )}
      </Section>

      {/* --- Claim 3: registered studies ------------------------------- */}
      <Section
        reveal
        title="3 · What has been registered in humans"
        note={clinical.checked ? `checked ${clinical.checkedAt?.slice(0, 10) ?? ""}` : "never checked"}
      >
        {!clinical.checked ? (
          <LimitationCallout title="Not yet checked">
            This medicine has never been queried against ClinicalTrials.gov here.
          </LimitationCallout>
        ) : trials.length === 0 ? (
          <LimitationCallout title="No evidence found">
            The registry was queried and returned nothing for this medicine.
          </LimitationCallout>
        ) : (
          <>
            <p className="m-0 mb-4 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
              {num(trials.length)} registered studies exist for this medicine.{" "}
              {amrTrials.length === 0 ? (
                <>
                  <strong>None of them concerns an infection.</strong> They are studies of
                  the approved endocrine indication and of pharmacokinetics in healthy
                  subjects. This is the clearest illustration on the site that a trial
                  count is not evidence about a pathogen.
                </>
              ) : (
                <>
                  {num(amrTrials.length)} matched an antimicrobial-resistance keyword; a
                  keyword match is a retrieval artefact, not a result.
                </>
              )}
            </p>
            <TableWrap label="Registered studies for this medicine">
              <thead>
                <tr>
                  <Th width="40%">Study</Th>
                  <Th width="24%">Conditions</Th>
                  <Th width="10%">Phase</Th>
                  <Th width="14%">Status</Th>
                  <Th width="12%">Registry</Th>
                </tr>
              </thead>
              <tbody>
                {trials.map((trial) => (
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
            <div className="mt-5">
              <LimitationCallout title="Completed is not successful, and unrelated is unrelated">
                A completed registration means the study finished, not that it worked.
                None of these studies was designed to measure antibacterial activity, so
                none of them supports or contradicts the prediction above.
              </LimitationCallout>
            </div>
          </>
        )}
      </Section>

      {/* --- Claim 4: training-data relationship ------------------------ */}
      <Section
        reveal
        title="4 · What the model had already seen"
        note="the reason this is a retrospective example"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="border border-rule bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              This exact molecule in the ACTIVE training data
            </p>
            <p className="m-0 mt-1.5 font-display text-[15px] font-semibold text-ink">
              {prediction?.inTrainingData === true
                ? `Yes — ${prediction.trainingSplit ?? "split unrecorded"} split`
                : prediction?.inTrainingData === false
                  ? "No — this stereoisomer was not a training example"
                  : "Membership could not be established"}
            </p>
            <p className="m-0 mt-2 max-w-[60ch] text-[12px] leading-relaxed text-ink-2">
              Membership is read from the dataset the ACTIVE model was trained on, not
              from a flag, so it moves when the dataset is rebuilt.
            </p>
          </div>

          <div className="border border-rule bg-raised p-5">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              Chemistry sharing this molecule&rsquo;s scaffold
            </p>
            {neighbours.length === 0 ? (
              <p className="m-0 mt-1.5 font-display text-[15px] font-semibold text-ink">
                None in the ACTIVE training data
              </p>
            ) : (
              <>
                <p className="m-0 mt-1.5 font-display text-[15px] font-semibold text-ink">
                  {num(neighbours.length)} training{" "}
                  {neighbours.length === 1 ? "record" : "records"}
                </p>
                <ul className="m-0 mt-2 list-none p-0">
                  {neighbours.map((n) => (
                    <li
                      key={`${n.moleculeId}-${n.pathogenKey}-${n.datasetVersion}`}
                      className="font-mono text-[11px] leading-relaxed text-ink-2"
                    >
                      {n.prefName ?? n.moleculeId} · {labelFor(n.pathogenKey)} ·{" "}
                      {n.split ?? "split unrecorded"} ·{" "}
                      {n.label === null
                        ? "label unrecorded"
                        : n.label === 1
                          ? "labelled active"
                          : "labelled inactive"}
                      {n.sameSkeleton ? " · same connectivity skeleton" : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {neighbours.length > 0 ? (
          <div className="mt-5">
            <WarningCallout title="Why the score is recall rather than discovery">
              Even where this exact stereoisomer was not a training example, molecules
              with the same Murcko scaffold were — and at least one of them carries the
              identical InChIKey connectivity skeleton, meaning the two differ only in
              stereochemistry. The model has therefore already seen this chemistry with a
              label attached. Reporting the score as an unseen prediction would be
              literally true about the molecule and misleading about the result.
            </WarningCallout>
          </div>
        ) : null}

        {subjectMeasured ? (
          <p className="m-0 mt-4 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
            Laboratory records for this molecule against {labelFor(SUBJECT.pathogen)}:{" "}
            {num(subjectMeasured.records)}, of which {num(subjectMeasured.actives)}{" "}
            {subjectMeasured.actives === 1 ? "is" : "are"} labelled active.
          </p>
        ) : (
          <p className="m-0 mt-4 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
            No laboratory measurement of this molecule against {labelFor(SUBJECT.pathogen)}{" "}
            is recorded here. Nothing in this case study is a measurement.
          </p>
        )}
      </Section>

      {/* --- The contrast ---------------------------------------------- */}
      <Section
        reveal
        title="For contrast: a held-out control"
        note={`${CONTROL.name.toLowerCase()} × ${labelFor(CONTROL.pathogen)}`}
      >
        {!controlId || !controlPrediction ? (
          <LimitationCallout title="The control is not available in this snapshot">
            No prediction for {CONTROL.name} against {labelFor(CONTROL.pathogen)} exists
            in the loaded data, so the contrast cannot be drawn honestly and is left out.
          </LimitationCallout>
        ) : (
          <>
            <div className="grid gap-px border border-rule bg-rule md:grid-cols-3">
              <div className="bg-raised p-5">
                <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  {ACTIVITY_LABEL}
                </p>
                <p
                  className="m-0 mt-1 font-mono text-[24px] font-medium tabular-nums leading-none"
                  style={{ color: "var(--color-computational)" }}
                >
                  {formatProbability(controlPrediction.probability)}
                </p>
                <p className="m-0 mt-2 font-mono text-[11px] text-muted">
                  {controlPrediction.modelVersion}
                </p>
              </div>
              <div className="bg-raised p-5">
                <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Position in the dataset
                </p>
                <p className="m-0 mt-1 font-display text-[15px] font-semibold text-ink">
                  {controlPrediction.trainingSplit
                    ? `${controlPrediction.trainingSplit} split`
                    : "not a dataset member"}
                </p>
                <p className="m-0 mt-2 max-w-[40ch] text-[12px] leading-relaxed text-ink-2">
                  {controlPrediction.trainingSplit === "test"
                    ? "Held out of training entirely, so this score is a prediction about data the model never fitted."
                    : "Read the split before reading the score."}
                </p>
              </div>
              <div className="bg-raised p-5">
                <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                  Laboratory records
                </p>
                <p className="m-0 mt-1 font-mono text-[20px] font-medium tabular-nums text-ink">
                  {num(controlMeasured[CONTROL.pathogen]?.records ?? 0)}
                </p>
                <p className="m-0 mt-2 font-mono text-[11px] text-muted">
                  {controlBest
                    ? `best pose ${controlBest.scoreKcalMol?.toFixed(3)} kcal/mol`
                    : "not yet docked"}
                </p>
              </div>
            </div>

            <p className="m-0 mt-4 max-w-[74ch] text-[13px] leading-relaxed text-ink-2">
              Ciprofloxacin is a fluoroquinolone antibiotic with{" "}
              {num(controlMeasured[CONTROL.pathogen]?.records ?? 0)} labelled measurements
              against {labelFor(CONTROL.pathogen)}, and it sits in the{" "}
              {controlPrediction.trainingSplit ?? "unrecorded"} split of{" "}
              {controlModel?.datasetVersion ?? "the active dataset"}. It is shown here as a
              methodological reference point: a high score on a held-out, well-measured
              antibiotic says something about the model that the same score on the
              retrospective example above does not.
            </p>

            <div className="mt-4">
              <LimitationCallout title="Still not a claim about treatment">
                The control demonstrates model behaviour on held-out data. It is not
                evidence that either medicine should be used against either organism, and
                a saturated score reads as {formatProbability(1)} because unanimity among
                trees is not certainty about the world.
              </LimitationCallout>
            </div>
          </>
        )}
      </Section>

      {/* --- What this does not establish ------------------------------ */}
      <Section reveal title="What this case study does not establish">
        <ul className="m-0 grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-2">
          {[
            [
              "Not a discovery",
              "The example was selected after the fact from records the system had already produced. A discovery claim requires a prediction made before the evidence is assembled.",
            ],
            [
              "Not a treatment claim",
              "Nothing here says this medicine treats tuberculosis, in a person or otherwise. Approval for Cushing's syndrome is not approval for an infection.",
            ],
            [
              "Not evidence of binding",
              "The docking score is a geometric estimate against a rigid receptor without its cofactor. No binding was measured.",
            ],
            [
              "Not clinical evidence",
              "The registered studies concern an endocrine indication and healthy-subject pharmacokinetics. None of them tested antibacterial activity.",
            ],
            [
              "Not resistance-specific",
              RESISTANCE_LIMITATION,
            ],
            [
              "Not a ranking",
              "This medicine is not presented as a better candidate than any other. The system produces no ranking of merit anywhere.",
            ],
          ].map(([title, body]) => (
            <li key={title} className="list-none bg-raised p-5">
              <p className="m-0 font-display text-[14px] font-semibold text-ink">{title}</p>
              <p className="m-0 mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-ink-2">
                {body}
              </p>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-5 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
          The same evidence for any other medicine is on{" "}
          <Link href="/medicines">Drug Details</Link>, and the rung a given pairing sits on
          is explained in <Link href="/explorer">Medicine × Condition</Link>.
        </p>
      </Section>

      {/* --- Provenance ------------------------------------------------- */}
      <Section reveal title="Provenance" note="every figure above, traced">
        <ProvenanceBlock
          rows={[
            ["Subject InChIKey", subjectId],
            ["Subject ChEMBL", medicine?.chemblId ?? null],
            ["Prediction", prediction ? `${prediction.probability} · ${prediction.modelVersion}` : null],
            ["Dataset", prediction?.datasetVersion ?? null],
            ["Feature version", prediction?.featureVersion ?? null],
            [
              "Docking",
              bestPose
                ? `${bestPose.scoreKcalMol?.toFixed(3)} kcal/mol · ${bestPose.targetKey} · ${bestPose.runId}`
                : "not yet docked",
            ],
            ["Target structure", target ? `PDB ${target.pdbId} · chain ${target.chain}` : null],
            [
              "Registry query",
              clinical.checked
                ? `ClinicalTrials.gov · ${num(trials.length)} studies · retrieved ${clinical.checkedAt?.slice(0, 10) ?? "date unrecorded"}`
                : "never queried",
            ],
            ["Control InChIKey", controlId],
            [
              "Control prediction",
              controlPrediction
                ? `${controlPrediction.probability} · ${controlPrediction.modelVersion} · ${controlPrediction.trainingSplit ?? "split unrecorded"}`
                : null,
            ],
          ]}
        />
      </Section>
    </Page>
  );
}
