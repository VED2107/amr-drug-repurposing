import Link from "next/link";
import { notFound } from "next/navigation";

import { TableWrap, Td, Th, Tr } from "@/components/data";
import { ActivityIndicator } from "@/components/evidence/ActivityIndicator";
import { EvidenceLadder } from "@/components/evidence/EvidenceIndicator";
import { StructureFigure } from "@/components/molecular/StructureFigure";
import {
  Breadcrumb,
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
  getBrandsForMolecule,
  getDockingForMolecule,
  getDockingTargets,
  getMedicineByMoleculeId,
  getMolecularProfile,
  getPathogens,
  getPredictionsForMolecule,
  getTrialsForMolecule,
  wasClinicallyChecked,
} from "@/lib/queries/core";
import {
  getMeasuredCountsByPathogen,
  getScaffoldNeighboursInTraining,
} from "@/lib/queries/medicines";
import {
  ACTIVITY_LABEL,
  DOCKING_SCREENING_TARGET_KCAL_MOL,
  DOCKING_TARGET_LABEL,
  RESISTANCE_LIMITATION,
  classifyRung,
} from "@/lib/science";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";

export const revalidate = 300;

/**
 * Drug Details — one medicine, in evidence order.
 *
 * Medicine → Activity → Molecular → Docking → Clinical → Provenance. The order
 * is the argument: what was predicted, what the molecule actually is, what the
 * geometry suggested, what has been registered in humans, and finally where
 * every one of those came from. Nothing on the page combines the sections into
 * a verdict, because the sections are different kinds of statement.
 */
export default async function MedicineDetailPage(props: {
  params: Promise<{ moleculeId: string }>;
}) {
  const { moleculeId: raw } = await props.params;
  const moleculeId = decodeURIComponent(raw);

  const medicine = await getMedicineByMoleculeId(moleculeId);
  if (!medicine) notFound();

  const [
    brands,
    profile,
    predictions,
    docking,
    targets,
    trials,
    clinical,
    measured,
    neighbours,
    pathogens,
  ] = await Promise.all([
    getBrandsForMolecule(moleculeId),
    getMolecularProfile(moleculeId),
    getPredictionsForMolecule(moleculeId),
    getDockingForMolecule(moleculeId),
    getDockingTargets(),
    getTrialsForMolecule(moleculeId),
    wasClinicallyChecked(moleculeId),
    getMeasuredCountsByPathogen(moleculeId),
    getScaffoldNeighboursInTraining(moleculeId),
    getPathogens(),
  ]);

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;
  const targetFor = (key: string) => targets.find((t) => t.targetKey === key) ?? null;

  // Best pose per target, and the poses behind it. A single number without the
  // run it came from is not traceable, so both are shown.
  const bestByTarget = new Map<string, number>();
  for (const pose of docking) {
    if (pose.status !== "ok" || pose.scoreKcalMol === null) continue;
    const current = bestByTarget.get(pose.targetKey);
    if (current === undefined || pose.scoreKcalMol < current) {
      bestByTarget.set(pose.targetKey, pose.scoreKcalMol);
    }
  }

  const rung = classifyRung({
    wasChecked: clinical.checked,
    // Trials here are for the medicine, across indications — see the callout.
    trialCount: trials.length,
    measuredRecords: Object.values(measured).reduce((a, m) => a + m.records, 0),
    hasPrediction: predictions.length > 0,
    hasDocking: bestByTarget.size > 0,
  });

  const amrTrials = trials.filter((t) => t.amrRelated);

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Explore", "Drug Details", medicine.genericName]} />
      <PageHeader
        eyebrow="Drug Details"
        title={medicine.genericName}
        lede={
          brands.length > 1
            ? `${brands.length} approved products share this structure.`
            : medicine.brandName
              ? `Marketed as ${medicine.brandName}.`
              : undefined
        }
        aside={
          <dl className="m-0 text-right">
            <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              InChIKey
            </dt>
            <dd className="m-0 break-all font-mono text-[11px] text-ink">{moleculeId}</dd>
            <dt className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              ChEMBL
            </dt>
            <dd className="m-0 font-mono text-[11px] text-ink">
              {orDash(medicine.chemblId)}
            </dd>
          </dl>
        }
      />

      {/* --- 1. Medicine ---------------------------------------------- */}
      <Section title="Medicine" note="as approved, from the FDA Orange Book">
        <dl className="m-0 grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Approval source", medicine.approvalSource],
            ["Approval status", medicine.approvalStatus],
            ["Application", medicine.applicationNo],
            ["Marketing status", medicine.marketingStatus],
            ["Dosage form", medicine.dosageForm],
            ["Route", medicine.route],
            ["Approval date", medicine.approvalDate],
            ["Structure match method", medicine.matchMethod],
          ].map(([term, value]) => (
            <div key={term as string} className="bg-raised p-4">
              <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                {term}
              </dt>
              <dd className="m-0 mt-1 font-mono text-[12px] text-ink">{orDash(value)}</dd>
            </div>
          ))}
        </dl>

        {brands.length > 1 ? (
          <p className="m-0 mt-4 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
            Approved products sharing this structure:{" "}
            {brands
              .map((b) => b.brandName ?? b.genericName)
              .filter((value, index, all) => all.indexOf(value) === index)
              .join(", ")}
            .
          </p>
        ) : null}

        <div className="mt-5">
          <LimitationCallout title="What approval establishes">
            This medicine is approved for the indication it was approved for. Nothing on
            this page is an approval, a recommendation, or evidence of activity in
            patients against any of the four bacteria below.
          </LimitationCallout>
        </div>
      </Section>

      {/* --- 2. Activity ---------------------------------------------- */}
      <Section
        title="Predicted activity"
        note="four models, four separate statements"
      >
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-2 xl:grid-cols-4">
          {PATHOGEN_KEYS.map((key: PathogenKey) => {
            const prediction = predictions.find((p) => p.pathogenKey === key) ?? null;
            const m = measured[key];
            return (
              <article key={key} className="bg-raised p-5">
                <h3 className="m-0 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  {labelFor(key)}
                </h3>
                <p className="m-0 mb-3 mt-0.5 font-mono text-[10px] text-fainter">
                  {pathogens.find((p) => p.key === key)?.fullName ?? ""}
                </p>

                <ActivityIndicator
                  pathogenKey={key}
                  probability={prediction?.probability ?? null}
                  modelVersion={prediction?.modelVersion ?? null}
                  inTrainingData={prediction?.inTrainingData ?? null}
                  trainingSplit={prediction?.trainingSplit ?? null}
                />

                <dl className="m-0 mt-4 border-t border-rule-soft pt-3">
                  <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    Lab measurements
                  </dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {m ? `${num(m.records)} records · ${num(m.actives)} labelled active` : "none recorded"}
                  </dd>
                  <dt className="m-0 mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    Best docking pose
                  </dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {(() => {
                      const target = targets.find((t) => t.pathogenKey === key);
                      const best = target ? bestByTarget.get(target.targetKey) : undefined;
                      if (best === undefined) return "not yet docked";
                      return `${best.toFixed(3)} kcal/mol · ${target?.gene ?? target?.targetKey}`;
                    })()}
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>

        {neighbours.length > 0 ? (
          <div className="mt-5">
            <WarningCallout title="Chemistry the models have already seen">
              This molecule shares a Murcko scaffold with{" "}
              {neighbours
                .map((n) => n.prefName ?? n.moleculeId)
                .filter((value, index, all) => all.indexOf(value) === index)
                .join(", ")}
              , which {neighbours.length === 1 ? "is" : "are"} present in the ACTIVE
              training data
              {neighbours.some((n) => n.sameSkeleton)
                ? ", and in at least one case as a stereoisomer with the identical connectivity skeleton"
                : ""}
              . A score for this molecule is therefore closer to recall of known chemistry
              than to a prediction about unseen chemistry, even where the molecule itself
              was not a training example.
              <ul className="m-0 mt-2 list-none p-0">
                {neighbours.map((n) => (
                  <li
                    key={`${n.moleculeId}-${n.pathogenKey}-${n.datasetVersion}`}
                    className="font-mono text-[11px] text-ink-2"
                  >
                    {n.prefName ?? n.moleculeId} · {labelFor(n.pathogenKey)} ·{" "}
                    {n.split ?? "split unrecorded"} ·{" "}
                    {n.label === null ? "label unrecorded" : n.label === 1 ? "labelled active" : "labelled inactive"}
                  </li>
                ))}
              </ul>
            </WarningCallout>
          </div>
        ) : null}

        <div className="mt-4">
          <LimitationCallout title="What these four numbers are">
            {RESISTANCE_LIMITATION} Each figure is a{" "}
            {ACTIVITY_LABEL.toLowerCase()} from one random forest, and none of them is a
            statement about treating an infection.
          </LimitationCallout>
        </div>
      </Section>

      {/* --- 3. Molecular --------------------------------------------- */}
      <Section title="Molecular" note="the structure the models actually saw">
        {profile === null ? (
          <LimitationCallout title="No structure record">
            This approved product did not resolve to a standardised structure, so it has
            no descriptors, no fingerprint and no prediction. That is a gap in the
            structure match, not a property of the medicine.
          </LimitationCallout>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
              <StructureFigure
                smiles={profile.canonicalSmiles}
                label={medicine.genericName}
                caption="Drawn from this record's own canonical SMILES. A depiction shows what the molecule is; it says nothing about whether it works."
              />
              <dl className="m-0 grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-3">
                {[
                ["Molecular weight", profile.mw?.toFixed(2)],
                ["logP", profile.logp?.toFixed(3)],
                ["TPSA", profile.tpsa?.toFixed(2)],
                ["H-bond donors", profile.hbd],
                ["H-bond acceptors", profile.hba],
                ["Rotatable bonds", profile.rotatableBonds],
                ["Aromatic rings", profile.aromaticRings],
                ["Heavy atoms", profile.heavyAtoms],
                ["Fraction Csp³", profile.fractionCsp3?.toFixed(3)],
                ["QED", profile.qed?.toFixed(3)],
                ["Lipinski violations", profile.lipinskiViolations],
                ["Feature version", profile.featureVersion],
              ].map(([term, value]) => (
                <div key={term as string} className="bg-raised p-4">
                  <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                    {term}
                  </dt>
                  <dd className="m-0 mt-1 font-mono text-[13px] tabular-nums text-ink">
                    {orDash(value as string | number | null)}
                  </dd>
                </div>
              ))}
              </dl>
            </div>

            <div className="mt-4 border border-rule bg-raised p-4">
              <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                Canonical SMILES
              </p>
              <p className="m-0 mt-1 break-all font-mono text-[12px] leading-relaxed text-ink-2">
                {orDash(profile.canonicalSmiles)}
              </p>
              <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
                Murcko scaffold
              </p>
              <div className="mt-1 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,240px)] md:items-start">
                <p className="m-0 break-all font-mono text-[12px] leading-relaxed text-ink-2">
                  {orDash(profile.murckoScaffold)}
                </p>
                <StructureFigure
                  smiles={profile.murckoScaffold}
                  label={`Murcko scaffold of ${medicine.genericName}`}
                  width={240}
                  height={180}
                  annotateStereo={false}
                />
              </div>
              <p className="m-0 mt-2 max-w-[68ch] text-[12px] leading-relaxed text-muted">
                The scaffold is written without stereochemistry on purpose: two
                enantiomers share one scaffold, so they cannot be split across training
                and test as though they were different chemistry.
              </p>
            </div>
          </>
        )}
      </Section>

      {/* --- 4. Docking ----------------------------------------------- */}
      <Section
        title="Docking"
        note={`${DOCKING_TARGET_LABEL.toLowerCase()} ${DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol`}
      >
        {docking.length === 0 ? (
          <LimitationCallout title="Not yet docked">
            No pose has been computed for this medicine. Docking has been run on a subset
            of the library, so an absent pose means the calculation has not been done —
            not that the molecule failed to dock.
          </LimitationCallout>
        ) : (
          <>
            <TableWrap label="Docking poses">
              <thead>
                <tr>
                  <Th width="26%">Target</Th>
                  <Th width="12%">Pathogen</Th>
                  <Th align="right" width="10%">
                    Pose
                  </Th>
                  <Th align="right" width="16%">
                    Score
                  </Th>
                  <Th align="right" width="18%">
                    RMSD lower / upper
                  </Th>
                  <Th width="18%">Run</Th>
                </tr>
              </thead>
              <tbody>
                {docking.slice(0, 20).map((pose) => {
                  const target = targetFor(pose.targetKey);
                  return (
                    <Tr key={`${pose.runId}-${pose.poseRank}`}>
                      <Td>
                        <span className="font-display text-[13px] font-semibold text-ink">
                          {target?.name ?? pose.targetKey}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-muted">
                          {target ? `${target.gene ?? "—"} · PDB ${target.pdbId} chain ${target.chain}` : ""}
                        </span>
                      </Td>
                      <Td>{labelFor(pose.pathogenKey)}</Td>
                      <Td align="right" mono>
                        {pose.poseRank}
                      </Td>
                      <Td align="right" mono>
                        {pose.scoreKcalMol === null ? "—" : pose.scoreKcalMol.toFixed(3)}
                        <span className="ml-1 text-[10px] text-muted">kcal/mol</span>
                      </Td>
                      <Td align="right" mono>
                        {pose.rmsdLb === null ? "—" : pose.rmsdLb.toFixed(3)} /{" "}
                        {pose.rmsdUb === null ? "—" : pose.rmsdUb.toFixed(3)}
                      </Td>
                      <Td mono className="text-[11px] text-muted">
                        {pose.runId}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableWrap>
            {docking.length > 20 ? (
              <p className="m-0 mt-3 font-mono text-[11px] text-muted">
                Showing the 20 best-scoring of {num(docking.length)} stored poses.
              </p>
            ) : null}
            <div className="mt-4">
              <LimitationCallout title="What a pose score is">
                A score is AutoDock Vina&rsquo;s estimate of how well a rigid receptor and
                a flexible ligand fit, in kcal/mol. It is not a measurement, not proof of
                binding, and{" "}
                {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol is this
                project&rsquo;s screening target rather than a universal cutoff.
              </LimitationCallout>
            </div>
          </>
        )}
      </Section>

      {/* --- 5. Clinical ---------------------------------------------- */}
      <Section
        title="Registered studies"
        note={clinical.checked ? `checked ${clinical.checkedAt?.slice(0, 10) ?? ""}` : "never checked"}
      >
        {!clinical.checked ? (
          <LimitationCallout title="Not yet checked">
            This medicine has never been queried against ClinicalTrials.gov in this
            system. That is different from no evidence found, and neither means no
            effect.
          </LimitationCallout>
        ) : trials.length === 0 ? (
          <LimitationCallout title="No evidence found">
            ClinicalTrials.gov was queried for this medicine and returned nothing. Absence
            of a registration is not evidence that the medicine has no effect.
          </LimitationCallout>
        ) : (
          <>
            <p className="m-0 mb-4 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
              {num(trials.length)} registered {trials.length === 1 ? "study" : "studies"},
              of which {num(amrTrials.length)} matched an antimicrobial-resistance
              keyword. Every one is a registration; none of them is a result.
            </p>
            <TableWrap label="Registered studies">
              <thead>
                <tr>
                  <Th width="34%">Study</Th>
                  <Th width="22%">Conditions</Th>
                  <Th width="10%">Phase</Th>
                  <Th width="14%">Status</Th>
                  <Th width="10%">Start</Th>
                  <Th width="10%">Registry</Th>
                </tr>
              </thead>
              <tbody>
                {trials.slice(0, 40).map((trial) => (
                  <Tr key={trial.nctId}>
                    <Td>
                      <span className="font-display text-[13px] text-ink">
                        {trial.briefTitle ?? trial.nctId}
                      </span>
                      {trial.amrRelated ? (
                        <span
                          className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em]"
                          style={{ color: "var(--color-clinical)" }}
                        >
                          matched an AMR keyword
                        </span>
                      ) : null}
                    </Td>
                    <Td>{trial.conditions.length ? trial.conditions.join("; ") : "—"}</Td>
                    <Td mono>{orDash(trial.phase)}</Td>
                    <Td mono>{orDash(trial.overallStatus)}</Td>
                    <Td mono>{orDash(trial.startDate)}</Td>
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
            {trials.length > 40 ? (
              <p className="m-0 mt-3 font-mono text-[11px] text-muted">
                Showing the 40 most recent of {num(trials.length)} registrations.
              </p>
            ) : null}
            <div className="mt-4">
              <LimitationCallout title="What a registration is">
                A registered trial is not a successful trial, and a trial of this medicine
                for another indication says nothing about these four bacteria. Approval
                for one use is not approval for another.
              </LimitationCallout>
            </div>
          </>
        )}
      </Section>

      {/* --- 6. Where this sits --------------------------------------- */}
      <Section title="Where this medicine sits" note="one rung, and what it does not mean">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <EvidenceLadder active={rung} />
          <div>
            <LimitationCallout title="The rung is for the medicine, not for a pairing">
              This classifies the records that exist for the medicine overall. A pairing
              of one medicine with one condition is graded separately — see{" "}
              <Link href="/explorer">Medicine × Disease</Link>, where a study for an
              unrelated indication does not count as clinical evidence.
            </LimitationCallout>
          </div>
        </div>
      </Section>

      {/* --- 7. Provenance -------------------------------------------- */}
      <Section title="Provenance" note="every figure above, traced">
        <ProvenanceBlock
          rows={[
            ["InChIKey", moleculeId],
            ["ChEMBL", medicine.chemblId],
            ["Approval record", `${medicine.approvalSource} · ${medicine.drugId}`],
            ["Structure match", medicine.matchMethod],
            [
              "Predictions",
              predictions.length
                ? predictions
                    .map((p) => `${labelFor(p.pathogenKey)} ${p.modelVersion}`)
                    .join(" · ")
                : "none from ACTIVE models",
            ],
            ["Dataset version", predictions[0]?.datasetVersion ?? null],
            ["Feature version", profile?.featureVersion ?? null],
            [
              "Docking runs",
              bestByTarget.size
                ? [...new Set(docking.map((d) => d.runId))].join(" · ")
                : "not yet docked",
            ],
            [
              "Registry query",
              clinical.checked
                ? `ClinicalTrials.gov · retrieved ${clinical.checkedAt?.slice(0, 10) ?? "date unrecorded"}`
                : "never queried",
            ],
          ]}
        />
      </Section>
    </Page>
  );
}
