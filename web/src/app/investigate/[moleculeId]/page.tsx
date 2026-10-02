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
import { LabRecords } from "@/components/investigate/LabRecords";
import { StructureFigure } from "@/components/molecular/StructureFigure";
import { StudiesToggle } from "@/components/investigate/StudiesToggle";
import { Page } from "@/components/primitives";
import { OrganismCell } from "@/components/story/diagrams";
import { medicineName } from "@/lib/format";
import {
  getBrandsForMolecule,
  getMeasuredCountsByPathogen,
  getMedicineByMoleculeId,
  getPathogens,
  getPredictionsForMolecule,
  wasClinicallyChecked,
} from "@/lib/queries/core";
import { getExistingUse, getRepurposingCandidates } from "@/lib/queries/repurposing";
import { existingUseText, type ExistingUse } from "@/lib/existing-use";
import {
  countStudiesForMedicine,
  getBestDocking,
  getStereoisomerInTraining,
  getStructureSmiles,
  getStudies,
  getStudyConditionsForMedicine,
} from "@/lib/queries/investigate";
import {
  DISCOVERY_THRESHOLD,
  DISCOVERY_THRESHOLD_TEXT,
  DOCKING_SCREENING_TARGET_KCAL_MOL, studyCountText, STUDIES_PER_MEDICINE_CAP } from "@/lib/science";
import { isPathogenKey, PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";
import { chemblCompound, pdbStructure } from "@/lib/links";
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

  const studyCondition = (firstValue(params, "sc") ?? "").trim();
  const chosen = firstValue(params, "p");
  const candidatePage = numberParam(params, "cp") ?? 1;
  // When the reader has picked a bacterium, its list does not wait for the
  // medicine's own predictions and can start with everything else.
  const early = isPathogenKey(chosen)
    ? getRepurposingCandidates({ pathogenKey: chosen, exclude: moleculeId, page: candidatePage })
    : null;
  // Marked handled now; if it fails, the `await` below still rethrows.
  early?.catch(() => undefined);

  // Every read that does not depend on another starts at once: one round trip
  // to the database for the whole page, not one for the medicine and another
  // for everything else.
  const [medicine, brands, pathogens, predictions, measured, docking, clinical, stereo, conditions, studies, studyTotal, smiles, uses] =
    await Promise.all([
      getMedicineByMoleculeId(moleculeId),
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
      getExistingUse([moleculeId]),
    ]);
  if (!medicine) notFound();

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
  const focus: PathogenKey | null = isPathogenKey(chosen) ? chosen : highest;

  const candidates = early
    ? await early
    : focus
      ? await getRepurposingCandidates({ pathogenKey: focus, exclude: moleculeId, page: candidatePage })
      : null;

  const path = `/investigate/${encodeURIComponent(moleculeId)}`;
  const n = (v: number) => v.toLocaleString("en-GB");
  const name = medicineName(medicine.genericName);
  const brandNames = [
    ...new Set(brands.map((b) => b.brandName).filter((b): b is string => !!b).map(medicineName)),
  ];
  const labPathogens = PATHOGEN_KEYS.filter((k) => measured[k]?.records);
  const use = uses.get(moleculeId);
  const qualifying = PATHOGEN_KEYS.filter((k) => (predictionFor(k)?.probability ?? 0) >= DISCOVERY_THRESHOLD);
  // The bacterium the reader came from reads first.
  const reasons = isPathogenKey(chosen) && qualifying.includes(chosen)
    ? [chosen, ...qualifying.filter((k) => k !== chosen)]
    : qualifying;
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
            .
          </p>
          <dl className="m-0 mt-6 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label="Registered studies" value={clinical.checked ? studyCountText(studyTotal) : "Not yet checked"} />
            <Fact label="Lab records" value={n(labTotal)} />
            <Fact
              label={`Pathogens at ${DISCOVERY_THRESHOLD_TEXT}`}
              value={`${predicted.filter((k) => (predictionFor(k)?.probability ?? 0) >= DISCOVERY_THRESHOLD).length} of 4`}
            />
          </dl>
        </div>
        <StructureFigure moleculeId={moleculeId} hasStructure={smiles !== null} label={name} priority />
      </header>

      {/* --- 1. Existing use ------------------------------------------ */}
      <div className="mt-12">
        <DocumentedBlock id="existing-use" title="Existing / approved use" tag="Documented · FDA, WHO, ChEMBL">
          <ExistingUseBody use={use} name={name} />
        </DocumentedBlock>
      </div>

      {/* --- 2. Why it appears here --------------------------------------- */}
      <section
        id="repurposing"
        aria-labelledby="repurposing-h"
        className="mt-6 scroll-mt-24 rounded-card border border-rule bg-raised p-4 md:p-6"
      >
        <h2 id="repurposing-h" className="m-0 font-display text-[clamp(19px,2vw,24px)] font-semibold tracking-[-0.01em] text-ink">
          Repurposing investigation
        </h2>
        <p className="m-0 mt-3 max-w-[72ch] text-[15px] leading-relaxed text-ink-2">
          {use?.status === "antibacterial" ? (
            <>
              {name} is already an antibacterial medicine, so it is not counted among the repurposing
              candidates. Its AI-predicted activity is shown below for reference.
            </>
          ) : reasons.length > 0 && use?.status !== "unclassified" && use?.status ? (
            <>
              This medicine is being investigated here for AI-predicted antibacterial activity
              against{" "}
              <strong className="font-semibold text-ink">{listOf(reasons.map(label))}</strong>. It was
              surfaced computationally for further investigation; it is not an established
              treatment for {reasons.length === 1 ? "this infection" : "these infections"}.
            </>
          ) : reasons.length > 0 ? (
            <>
              {name} reaches {DISCOVERY_THRESHOLD_TEXT} AI-predicted activity against{" "}
              {listOf(reasons.map(label))}, but no WHO ATC code or FDA pharmacologic class says
              whether it is already an antibacterial. It needs review, so it is not counted among
              the repurposing candidates.
            </>
          ) : (
            <>
              No supported bacterium reaches {DISCOVERY_THRESHOLD_TEXT} AI-predicted activity for{" "}
              {name}, so it is not among the repurposing candidates. Its predictions are shown below.
            </>
          )}
        </p>
      </section>

      {/* --- 3. AI-predicted activity ---------------------------------- */}
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

      {/* --- 4. Existing evidence ---------------------------------------- */}
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
                      {studyCountText(studyTotal)}
                    </span>
                    registered {studyTotal === 1 ? "study names" : "studies name"} this medicine,
                    for any condition.
                    {studyTotal >= STUDIES_PER_MEDICINE_CAP
                      ? ` The registry search keeps the first ${STUDIES_PER_MEDICINE_CAP}, so there may be more.`
                      : ""} <Link href="#studies">See them below</Link>.
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

            <div className="mt-5 flex flex-wrap gap-2 border-t border-rule-soft pt-4">
              {medicine.chemblId ? (
                <a href={chemblCompound(medicine.chemblId)} target="_blank" rel="noreferrer" className="amr-btn-quiet">
                  Open {name} in ChEMBL <span data-arrow aria-hidden="true">↗</span>
                </a>
              ) : null}
              {clinical.checked && studyTotal > 0 ? (
                <Link href="#studies" className="amr-btn-quiet">
                  Registered studies below <span data-arrow aria-hidden="true">↓</span>
                </Link>
              ) : null}
            </div>

            {labTotal > 0 ? (
              <LabRecords
                moleculeId={moleculeId}
                total={labTotal}
                pathogenLabels={Object.fromEntries(pathogens.map((p) => [p.key, p.label]))}
              />
            ) : null}
          </DocumentedBlock>

          <ComputationalBlock title="Docking" tag="Computational · nothing measured">
            {docking.length === 0 ? (
              <StateNote kind="unchecked" head="Not yet docked">
                Docking has been run for a subset of medicines only.
              </StateNote>
            ) : (
              <div className="flex flex-col gap-5">
                {docking.map((d) => (
                  <DockingRuler
                    key={d.pathogenKey}
                    score={d.scoreKcalMol}
                    target={DOCKING_SCREENING_TARGET_KCAL_MOL}
                    pathogen={d.pathogenKey}
                    pathogenLabel={label(d.pathogenKey)}
                    targetName={d.targetName}
                    href={d.pdbId ? pdbStructure(d.pdbId) : null}
                  />
                ))}
                <p className="m-0 text-[12px] leading-snug text-muted">
                  This project&rsquo;s screening target is{" "}
                  {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol, its own mark rather than a
                  universal cutoff. A docking score is not proof of binding.
                </p>
              </div>
            )}
          </ComputationalBlock>
        </div>
      </section>

      {/* --- Other medicines ------------------------------------------- */}
      <div className="mt-12">
        <ComputationalBlock id="candidates" title="Other medicines to investigate">
          <p className="m-0 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
            Other repurposing candidates: approved medicines besides {name} with AI-predicted
            activity {DISCOVERY_THRESHOLD_TEXT} against the chosen bacterium, leaving out existing
            antibacterials. They are computational candidates for further investigation, not
            alternatives and not recommendations.
          </p>

          <nav aria-label="Bacterium" className="amr-species mt-4 inline-flex flex-wrap gap-1 rounded-[26px] bg-sunken p-1">
            {PATHOGEN_KEYS.map((k) => {
              const on = k === focus;
              return (
                <Link
                  key={k}
                  href={`${withParams(path, params, { p: k, cp: null })}#candidates`}
                  aria-current={on ? "true" : undefined}
                  scroll={false}
                  className={`amr-species-link inline-flex min-h-10 items-center gap-2 rounded-full py-1 pl-1.5 pr-3.5 font-display text-[13px] font-semibold no-underline ${
                    k === "mrsa" ? "" : "italic"
                  }`}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-raised">
                    <OrganismCell pathogen={k} size={22} />
                  </span>
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

      {/* --- 5. Clinical studies ----------------------------------------- */}
      <section id="studies" className="mt-12 scroll-mt-24">
        <SectionHead title="Registered studies" note={STUDY_NOTE} />
        {!clinical.checked ? (
          <p className="m-0 text-[13px] text-ink-2">
            Not yet checked: the registry has not been searched for this medicine.
          </p>
        ) : (
          <>
            {conditions.length > 0 ? (
              <form action={`${path}#studies`} method="get" className="mb-4 flex flex-wrap items-end gap-2.5">
                {focus && firstValue(params, "p") ? <input type="hidden" name="p" value={focus} /> : null}
                <label className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1.5 sm:max-w-[520px]">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    Condition
                  </span>
                  <span className="amr-filter flex items-center">
                  <select
                    name="sc"
                    defaultValue={studyCondition}
                    className="amr-search-input min-h-10 w-full min-w-0 flex-1 appearance-none bg-transparent px-3 font-mono text-[12px] text-ink"
                  >
                    <option value="">All conditions</option>
                    {conditions.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({n(c.studies)})
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="amr-select-chevron" />
                  <button type="submit" className="amr-search-go amr-search-go-sm">
                    Filter
                    <span aria-hidden="true" className="amr-search-go-cap">
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
                  </button>
                  </span>
                </label>
                {studies.total > 0 ? <StudiesToggle target="medicine-studies" total={studies.total} /> : null}
              </form>
            ) : studies.total > 0 ? (
              <div className="mb-4">
                <StudiesToggle target="medicine-studies" total={studies.total} />
              </div>
            ) : null}
            <div id="medicine-studies">
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
            </div>
          </>
        )}
      </section>

      <div className="mt-12">
        <DoesNotEstablish />
      </div>
    </Page>
  );
}

/**
 * A docking score placed on a short kcal/mol scale (0 to -12, more negative is
 * a better fit), with this project's screening target marked. A picture of a
 * computer estimate: nothing here was measured.
 */
function DockingRuler({
  score,
  target,
  pathogen,
  pathogenLabel,
  targetName,
  href,
}: {
  score: number;
  target: number;
  pathogen: PathogenKey;
  pathogenLabel: string;
  targetName: string;
  href: string | null;
}) {
  const MIN = -12;
  const pos = (v: number) => `${Math.max(0, Math.min(1, v / MIN)) * 100}%`;
  const meets = score <= target;
  return (
    <div>
      <p className="m-0 flex items-center gap-2 text-[13px] leading-snug text-ink-2">
        <OrganismCell pathogen={pathogen} size={22} />
        <span>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {targetName} ↗
            </a>
          ) : (
            targetName
          )}{" "}
          <span className="text-muted">({pathogenLabel})</span>
        </span>
      </p>
      <p className="m-0 mt-2 font-mono text-[22px] tabular-nums leading-none" style={{ color: meets ? "var(--color-computational)" : "var(--color-ink)" }}>
        {score.toFixed(1)} <span className="text-[12px] text-muted">kcal/mol</span>
      </p>
      <div aria-hidden="true" className="relative mt-5 h-[10px]">
        <span className="absolute inset-x-0 top-1/2 block h-px bg-rule-strong" />
        <span className="absolute -top-[5px] block h-5 w-px bg-accent" style={{ left: pos(target) }} />
        <span className="absolute -top-[18px] -translate-x-1/2 font-mono text-[9.5px] text-accent" style={{ left: pos(target) }}>
          {target.toFixed(1)}
        </span>
        <span
          className="amr-dock-marker absolute top-1/2 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2"
          style={{
            left: pos(score),
            borderColor: "var(--color-computational)",
            background: meets ? "var(--color-computational)" : "var(--color-raised)",
          }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-muted">
        <span>0</span>
        <span>better fit →</span>
        <span>{MIN}</span>
      </div>
    </div>
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
    <div className="amr-evidence-tile rounded-card border border-rule bg-paper p-4" data-kind={kind}>
      <p className="m-0 mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-raised">
          <EvidenceIcon kind={kind} size={12} />
        </span>
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

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const STATUS_LINE: Record<string, string> = {
  antibacterial: "Classified as an existing antibacterial.",
  other_anti_infective:
    "Classified as an anti-infective that is not an antibacterial (for example an antifungal, antiviral or antiparasitic medicine).",
  not_anti_infective: "Not classified as an anti-infective.",
  unclassified:
    "Neither a WHO ATC code nor an FDA pharmacologic class was found for it, so whether it is already an antibacterial is not established. It needs review and is not counted as a repurposing candidate.",
};

/** What the medicine is already approved and classified for, with sources. */
function ExistingUseBody({ use, name }: { use: ExistingUse | undefined; name: string }) {
  const summary = existingUseText(use, 12);
  if (!use || (!summary && !use.status)) {
    return (
      <StateNote kind="unchecked" head="Not yet checked">
        The approved use of {name} has not been looked up in the classification sources yet.
      </StateNote>
    );
  }
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div>
        {use.indications.length > 0 ? (
          <>
            <p className="m-0 text-[12px] text-muted">Approved for</p>
            <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
              {use.indications.slice(0, 16).map((i) => (
                <li key={i} className="rounded-full border border-clinical/40 bg-paper px-3 py-1 text-[13px] text-ink">
                  {i.charAt(0).toUpperCase() + i.slice(1)}
                </li>
              ))}
              {use.indications.length > 16 ? (
                <li className="px-1 py-1 text-[13px] text-muted">and {use.indications.length - 16} more</li>
              ) : null}
            </ul>
            <p className="m-0 mt-2 text-[12px] leading-snug text-muted">
              Indications ChEMBL records as approved, from FDA and DailyMed labels.
              {use.indicationSource ? (
                <>
                  {" "}
                  <a href={use.indicationSource} target="_blank" rel="noreferrer">
                    Label ↗
                  </a>
                </>
              ) : null}
            </p>
          </>
        ) : (
          <StateNote kind="none" head="No approved indication recorded">
            ChEMBL records no approved indication for {name}. Its therapeutic class is shown instead.
          </StateNote>
        )}
      </div>
      <dl className="m-0 grid content-start gap-3 text-[13px]">
        {use.atcGroups.length > 0 ? (
          <div>
            <dt className="text-[12px] text-muted">WHO therapeutic group</dt>
            <dd className="m-0 mt-0.5 text-ink">
              {use.atcGroups
                .slice(0, 5)
                .map((g) => g.charAt(0) + g.slice(1).toLowerCase())
                .join("; ")}
            </dd>
          </div>
        ) : null}
        {use.fdaClasses.length > 0 ? (
          <div>
            <dt className="text-[12px] text-muted">FDA pharmacologic class</dt>
            <dd className="m-0 mt-0.5 text-ink">
              {use.fdaClasses.join("; ")}
              {use.labelSetId ? (
                <>
                  {" "}
                  <a
                    href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(use.labelSetId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    FDA label ↗
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        {use.status ? (
          <div>
            <dt className="text-[12px] text-muted">Anti-infective classification</dt>
            <dd className="m-0 mt-0.5 leading-snug text-ink-2">
              {STATUS_LINE[use.status]}
              {use.basis && use.status !== "not_anti_infective" ? (
                <span className="mt-0.5 block font-mono text-[11px] text-muted">{use.basis}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
