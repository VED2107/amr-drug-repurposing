import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ActivityRow,
  CandidateList,
  ComputationalBlock,
  DocumentedBlock,
  DoesNotEstablish,
  EvidenceIcon,
  SectionHead,
  StateNote,
  StudyList,
  STUDY_NOTE,
} from "@/components/investigate";
import { StructureFigure } from "@/components/molecular/StructureFigure";
import { Page } from "@/components/primitives";
import { formatUnits, medicineName } from "@/lib/format";
import {
  getBrandsForMolecule,
  getMeasuredCountsByPathogen,
  getMedicineByMoleculeId,
  getPathogens,
  getPredictionsForMolecule,
  wasClinicallyChecked,
} from "@/lib/queries/core";
import {
  countStudiesForMedicine,
  getBestDocking,
  getCandidates,
  getLabRecords,
  getStereoisomerInTraining,
  getStructureSmiles,
  getStudies,
  getStudyConditionsForMedicine,
} from "@/lib/queries/investigate";
import {
  DISCOVERY_THRESHOLD,
  DISCOVERY_THRESHOLD_TEXT,
  DOCKING_SCREENING_TARGET_KCAL_MOL,
} from "@/lib/science";
import { isPathogenKey, PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";
import { chemblAssay, chemblCompound, chemblDocument, pdbStructure } from "@/lib/links";
import { firstValue, numberParam, withParams, type RawSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * One medicine: its AI-predicted activity, its documented evidence, the other
 * medicines worth investigating alongside it, and its registered studies.
 *
 * Every medicine — searched for or reached from another medicine's list — opens
 * here, at a URL that names it, so a result survives a refresh or a share.
 */
export default async function MedicinePage(props: {
  params: Promise<{ moleculeId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { moleculeId: raw } = await props.params;
  const moleculeId = decodeURIComponent(raw);
  const params = await props.searchParams;

  const medicine = await getMedicineByMoleculeId(moleculeId);
  if (!medicine) notFound();

  const studyCondition = (firstValue(params, "sc") ?? "").trim();

  const [brands, pathogens, predictions, measured, docking, clinical, stereo, conditions, studies, studyTotal, smiles, labRecords] =
    await Promise.all([
      getBrandsForMolecule(moleculeId),
      getPathogens(),
      getPredictionsForMolecule(moleculeId),
      getMeasuredCountsByPathogen(moleculeId),
      getBestDocking(moleculeId),
      wasClinicallyChecked(moleculeId),
      getStereoisomerInTraining(moleculeId),
      getStudyConditionsForMedicine(moleculeId),
      getStudies({
        moleculeId,
        terms: studyCondition ? [studyCondition.toLowerCase()] : undefined,
        page: numberParam(params, "sp") ?? 1,
      }),
      countStudiesForMedicine(moleculeId),
      getStructureSmiles(moleculeId),
      getLabRecords(moleculeId),
    ]);

  const label = (key: PathogenKey) => pathogens.find((p) => p.key === key)?.label ?? key;
  const predictionFor = (key: PathogenKey) => predictions.find((p) => p.pathogenKey === key) ?? null;

  // Which pathogen the "other medicines" list is about: the reader's choice,
  // else the one this medicine's own prediction is highest for.
  const predicted = PATHOGEN_KEYS.filter((k) => predictionFor(k) !== null);
  const highest = predicted.length
    ? predicted.reduce((a, b) =>
        (predictionFor(a)?.probability ?? 0) >= (predictionFor(b)?.probability ?? 0) ? a : b,
      )
    : null;
  const chosen = firstValue(params, "p");
  const focus: PathogenKey | null = isPathogenKey(chosen) ? chosen : highest;

  const candidates = focus
    ? await getCandidates({ pathogenKey: focus, exclude: moleculeId, page: numberParam(params, "cp") ?? 1 })
    : null;

  const path = `/investigate/${encodeURIComponent(moleculeId)}`;
  const n = (v: number) => v.toLocaleString("en-GB");
  const name = medicineName(medicine.genericName);
  const brandNames = [
    ...new Set(brands.map((b) => b.brandName).filter((b): b is string => !!b).map(medicineName)),
  ];
  const labPathogens = PATHOGEN_KEYS.filter((k) => measured[k]?.records);
  const labTotal = labPathogens.reduce((a, k) => a + measured[k].records, 0);
  // The Orange Book writes form and route together ("TABLET;ORAL").
  const product = (medicine.dosageForm ?? medicine.route ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");

  return (
    <Page>
      <header className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:gap-10">
        <div className="min-w-0">
          <h1 className="m-0 break-words font-display text-[clamp(32px,4.6vw,56px)] font-semibold leading-[1.03] tracking-[-0.03em] text-ink">
            {name}
          </h1>
          <p className="m-0 mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
            FDA-approved product{product ? ` (${product})` : ""}
            {brandNames.length
              ? `, marketed as ${brandNames.slice(0, 3).join(", ")}${brandNames.length > 3 ? ` and ${brandNames.length - 3} more` : ""}`
              : ""}
            . The indication it is approved for is not recorded in this dataset.
          </p>
          <dl className="m-0 mt-6 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label="Registered studies" value={clinical.checked ? n(studyTotal) : "Not yet checked"} />
            <Fact label="Lab records" value={n(labTotal)} />
            <Fact
              label={`Pathogens at ${DISCOVERY_THRESHOLD_TEXT}`}
              value={`${predicted.filter((k) => (predictionFor(k)?.probability ?? 0) >= DISCOVERY_THRESHOLD).length} of 4`}
            />
          </dl>
        </div>
        <StructureFigure smiles={smiles} label={name} width={420} height={300} />
      </header>

      {/* --- AI-predicted activity ---------------------------------- */}
      <div className="mt-12">
        <ComputationalBlock id="activity" title="AI-predicted activity">
          <ul className="m-0 list-none p-0">
            {PATHOGEN_KEYS.map((key) => {
              const prediction = predictionFor(key);
              const trained = prediction?.inTrainingData === true;
              const mirror = !trained && stereo.includes(key);
              return (
                <ActivityRow
                  key={key}
                  pathogenKey={key}
                  pathogenLabel={label(key)}
                  probability={prediction?.probability ?? null}
                  note={
                    trained
                      ? "This medicine was in the model's training data, so this is recall, not a new prediction."
                      : mirror
                        ? "A stereoisomer of this medicine was in the model's training data."
                        : undefined
                  }
                />
              );
            })}
          </ul>
          <p className="m-0 mt-3 text-[12px] leading-relaxed text-muted">
            A model&rsquo;s estimate of laboratory activity against each bacterial species. It is
            not clinical effectiveness.
          </p>
        </ComputationalBlock>
      </div>

      {/* --- Evidence --------------------------------------------------- */}
      <section aria-labelledby="evidence-h" className="mt-12">
        <h2 id="evidence-h" className="sr-only">
          Evidence
        </h2>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DocumentedBlock id="evidence" title="Clinical and experimental">
            <div className="grid gap-6 sm:grid-cols-2">
              <EvidencePart kind="clinical" title="Clinical">
                {!clinical.checked ? (
                  <StateNote kind="unchecked" head="Not yet checked">
                    The trial registry has not been searched for this medicine.
                  </StateNote>
                ) : studyTotal === 0 ? (
                  <StateNote kind="none" head="No evidence found">
                    The registry was searched and no registered study names this medicine.
                  </StateNote>
                ) : (
                  <p className="m-0 text-[13px] leading-snug text-ink-2">
                    <span className="block font-mono text-[24px] font-medium tabular-nums text-ink">
                      {n(studyTotal)}
                    </span>
                    registered {studyTotal === 1 ? "study names" : "studies name"} this medicine,
                    for any condition. <Link href="#studies">See them below</Link>.
                  </p>
                )}
              </EvidencePart>

              <EvidencePart kind="experimental" title="Experimental">
                {labPathogens.length === 0 ? (
                  <StateNote kind="none" head="No evidence found">
                    No laboratory measurement against the four bacteria in the ChEMBL records
                    loaded here.
                  </StateNote>
                ) : (
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    {labPathogens.map((k) => (
                      <li key={k} className="text-[13px] leading-snug text-ink-2">
                        <strong className="font-semibold text-ink">{label(k)}</strong>: measured
                        active in {n(measured[k].actives)} of {n(measured[k].records)} lab{" "}
                        {measured[k].records === 1 ? "record" : "records"}
                      </li>
                    ))}
                  </ul>
                )}
              </EvidencePart>
            </div>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-rule-soft pt-4 text-[13px]">
              {medicine.chemblId ? (
                <a href={chemblCompound(medicine.chemblId)} target="_blank" rel="noreferrer">
                  Open {name} in ChEMBL ↗
                </a>
              ) : null}
              {clinical.checked && studyTotal > 0 ? <Link href="#studies">Registered studies below</Link> : null}
            </div>

            {labRecords.length > 0 ? (
              <details className="group mt-4">
                <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
                  {labTotal > labRecords.length
                    ? `Show the latest ${n(labRecords.length)} of ${n(labTotal)} laboratory records, with sources`
                    : `Show the ${n(labRecords.length)} laboratory ${labRecords.length === 1 ? "record" : "records"}, with sources`}
                </summary>
                <ul className="m-0 mt-2 max-h-[420px] list-none overflow-y-auto rounded-card border border-rule p-0">
                  {labRecords.map((r, i) => (
                    <li key={`${r.assayId}-${i}`} className="grid gap-x-4 gap-y-1 border-b border-rule-soft px-3 py-2.5 text-[12px] leading-snug last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)_11rem_auto]">
                      <span className="font-medium text-ink">{label(r.pathogenKey)}</span>
                      <span className="text-ink-2">{r.assayDescription ?? "Assay description not recorded"}</span>
                      <span className="font-mono tabular-nums text-ink">
                        {r.activityType ?? "Value"} {r.relation && r.relation !== "=" ? r.relation : ""}
                        {r.value ?? "—"} {formatUnits(r.units)}
                        <span className={`ml-1.5 font-sans ${r.label === 1 ? "text-experimental" : "text-muted"}`}>
                          {r.label === 1 ? "active" : "inactive"}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-x-3">
                        {r.assayId ? (
                          <a href={chemblAssay(r.assayId)} target="_blank" rel="noreferrer">
                            Assay ↗
                          </a>
                        ) : null}
                        {r.documentId ? (
                          <a href={chemblDocument(r.documentId)} target="_blank" rel="noreferrer">
                            Source{r.year ? ` ${r.year}` : ""} ↗
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="m-0 mt-2 text-[12px] text-muted">
                  {labTotal > labRecords.length ? "Every record is in ChEMBL, linked above. " : ""}
                  &ldquo;Active&rdquo; means the measured value reached this project&rsquo;s laboratory
                  cutoff (10&nbsp;µM or stronger). A laboratory result does not show an effect in patients.
                </p>
              </details>
            ) : null}
          </DocumentedBlock>

          <ComputationalBlock title="Docking" tag="Computational · nothing measured">
            {docking.length === 0 ? (
              <StateNote kind="unchecked" head="Not yet docked">
                Docking has been run for a subset of medicines only.
              </StateNote>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {docking.map((d) => (
                  <li key={d.pathogenKey} className="text-[13px] leading-snug text-ink-2">
                    {d.pdbId ? (
                      <a href={pdbStructure(d.pdbId)} target="_blank" rel="noreferrer">
                        {d.targetName} ↗
                      </a>
                    ) : (
                      d.targetName
                    )}{" "}
                    ({label(d.pathogenKey)}):{" "}
                    <span className="font-mono tabular-nums text-ink">
                      {d.scoreKcalMol.toFixed(1)} kcal/mol
                    </span>
                  </li>
                ))}
                <li className="text-[12px] leading-snug text-muted">
                  This project&rsquo;s screening target is{" "}
                  {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol. A docking score is not
                  proof of binding.
                </li>
              </ul>
            )}
          </ComputationalBlock>
        </div>
      </section>

      {/* --- Other medicines ------------------------------------------- */}
      <div className="mt-12">
        <ComputationalBlock id="candidates" title="Other medicines to investigate">
          <p className="m-0 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
            Medicines other than {name} with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT}{" "}
            against the chosen bacterium. They are computational candidates
            for further investigation, not alternatives and not recommendations.
          </p>

          <nav aria-label="Bacterium" className="mt-4 flex flex-wrap gap-1.5">
            {PATHOGEN_KEYS.map((k) => {
              const on = k === focus;
              return (
                <Link
                  key={k}
                  href={`${withParams(path, params, { p: k, cp: null })}#candidates`}
                  aria-current={on ? "true" : undefined}
                  scroll={false}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-card border px-3 font-display text-[13px] font-semibold no-underline ${
                    on ? "border-ink bg-ink text-paper" : "border-rule-strong bg-raised text-ink hover-row"
                  }`}
                >
                  {label(k)}
                </Link>
              );
            })}
          </nav>

          <div className="mt-5">
            {focus && candidates ? (
              <CandidateList
                data={candidates}
                pathogenLabel={label(focus)}
                path={path}
                params={params}
                anchor="candidates"
                pageParam="cp"
              />
            ) : (
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">
                {name} has no AI prediction. Choose a bacterium above to see the medicines that do.
              </p>
            )}
          </div>
        </ComputationalBlock>
      </div>

      {/* --- Registered studies ---------------------------------------- */}
      <section id="studies" className="mt-12 scroll-mt-24">
        <SectionHead title="Registered studies" note={STUDY_NOTE} />
        {!clinical.checked ? (
          <p className="m-0 text-[13px] text-ink-2">
            Not yet checked: the registry has not been searched for this medicine.
          </p>
        ) : (
          <>
            {conditions.length > 0 ? (
              <form action={`${path}#studies`} method="get" className="mb-4 flex flex-wrap items-end gap-2">
                {focus && firstValue(params, "p") ? <input type="hidden" name="p" value={focus} /> : null}
                <label className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1.5 sm:max-w-[420px]">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    Condition
                  </span>
                  <select
                    name="sc"
                    defaultValue={studyCondition}
                    className="min-h-11 w-full rounded-card border border-rule-strong bg-pure px-3 font-mono text-[12px] text-ink"
                  >
                    <option value="">All conditions</option>
                    {conditions.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({n(c.studies)})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="amr-btn-quiet">
                  Filter
                </button>
              </form>
            ) : null}
            <StudyList
              data={studies}
              path={path}
              params={params}
              anchor="studies"
              pageParam="sp"
              empty={
                studyCondition
                  ? `No registered study for ${name} lists “${studyCondition}”.`
                  : "No evidence found: the registry was searched and no registered study names this medicine."
              }
            />
          </>
        )}
      </section>

      <div className="mt-12">
        <DoesNotEstablish />
      </div>
    </Page>
  );
}

function EvidencePart({
  kind,
  title,
  children,
}: {
  kind: "clinical" | "experimental";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="m-0 mb-2.5 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
        <EvidenceIcon kind={kind} size={12} />
        {title}
      </p>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 font-mono text-[18px] font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
