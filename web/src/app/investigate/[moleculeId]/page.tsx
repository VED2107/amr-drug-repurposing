import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ActivityRow,
  CandidateList,
  ComputationalBlock,
  DocumentedBlock,
  DoesNotEstablish,
  SectionHead,
  StudyList,
  STUDY_NOTE,
} from "@/components/investigate";
import { Page } from "@/components/primitives";
import { medicineName } from "@/lib/format";
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
  getStereoisomerInTraining,
  getStudies,
  getStudyConditionsForMedicine,
} from "@/lib/queries/investigate";
import { DISCOVERY_THRESHOLD_TEXT, DOCKING_SCREENING_TARGET_KCAL_MOL } from "@/lib/science";
import { isPathogenKey, PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";
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

  const [brands, pathogens, predictions, measured, docking, clinical, stereo, conditions, studies, studyTotal] =
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
  const brandNames = [...new Set(brands.map((b) => b.brandName).filter((b): b is string => !!b))];
  const labPathogens = PATHOGEN_KEYS.filter((k) => measured[k]?.records);
  // The Orange Book writes form and route together ("TABLET;ORAL").
  const product = (medicine.dosageForm ?? medicine.route ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");

  return (
    <Page>
      <p className="m-0 mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Medicine</p>
      <h1 className="m-0 break-words font-display text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
        {name}
      </h1>
      <p className="m-0 mt-3 max-w-[72ch] text-[14px] leading-relaxed text-ink-2">
        FDA-approved product{product ? ` (${product})` : ""}
        {brandNames.length ? `, marketed as ${brandNames.slice(0, 4).join(", ")}${brandNames.length > 4 ? ` and ${brandNames.length - 4} more` : ""}` : ""}
        . The indication it is approved for is not recorded in this dataset.
      </p>

      {/* --- AI-predicted activity ---------------------------------- */}
      <div className="mt-10">
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
              <EvidencePart glyph="◆" color="var(--color-clinical)" title="Clinical">
                {!clinical.checked ? (
                  <State tone="unchecked" head="Not yet checked">
                    The trial registry has not been searched for this medicine.
                  </State>
                ) : studyTotal === 0 ? (
                  <State tone="none" head="No evidence found">
                    The registry was searched and no registered study names this medicine.
                  </State>
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

              <EvidencePart glyph="■" color="var(--color-experimental)" title="Experimental">
                {labPathogens.length === 0 ? (
                  <State tone="none" head="No evidence found">
                    No laboratory measurement against the four bacteria in the ChEMBL records
                    loaded here.
                  </State>
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
          </DocumentedBlock>

          <ComputationalBlock title="Docking" kicker="Computational evidence">
            {docking.length === 0 ? (
              <State tone="unchecked" head="Not yet docked">
                Docking has been run for a subset of medicines only.
              </State>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {docking.map((d) => (
                  <li key={d.pathogenKey} className="text-[13px] leading-snug text-ink-2">
                    {d.targetName} ({label(d.pathogenKey)}):{" "}
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
  glyph,
  color,
  title,
  children,
}: {
  glyph: string;
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="m-0 mb-2 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
        <span aria-hidden="true" style={{ color }}>
          {glyph}
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

function State({
  tone,
  head,
  children,
}: {
  tone: "none" | "unchecked";
  head: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className="m-0 font-mono text-[11px] uppercase tracking-[0.1em]"
        style={{ color: tone === "none" ? "var(--color-none)" : "var(--color-unchecked)" }}
      >
        <span aria-hidden="true">{tone === "none" ? "○ " : "— "}</span>
        {head}
      </p>
      <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink-2">{children}</p>
    </div>
  );
}
