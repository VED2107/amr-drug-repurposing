import type { Metadata } from "next";
import Link from "next/link";

import { EvidenceIcon } from "@/components/investigate/icons";
import { Page } from "@/components/primitives";
import { MethodsNav } from "@/components/story/MethodsNav";
import { StageGlyph } from "@/components/story/Pipeline";
import { Training } from "@/components/story/Training";
import { getRepurposingSummary } from "@/lib/queries/repurposing";
import { getStoryFigures, getTrainingFigures } from "@/lib/queries/story";
import {
  DISCOVERY_THRESHOLD_TEXT,
  DOCKING_SCREENING_TARGET_KCAL_MOL,
  LABEL_ACTIVE_MICROMOLAR,
  LABEL_INACTIVE_MICROMOLAR,
} from "@/lib/science";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Method · AMR Drug Repurposing",
  description:
    "What the project used, how the four models were trained, and how to read each kind of result. " +
    "Every result is computational and is a lead for laboratory testing, not evidence of treatment.",
};

const n = (v: number) => v.toLocaleString("en-GB");

/**
 * The full method, reached from the overview's training section (it is not in
 * the main navigation). It names the sources and tools the presentation names
 * (slide 7), walks through training step by step, and explains every kind of
 * result in more detail than the overview has room for. Counts are live.
 */
export default async function Methods() {
  const [summary, figures, training] = await Promise.all([
    getRepurposingSummary(),
    getStoryFigures(),
    getTrainingFigures(),
  ]);
  const labelled = training.perPathogen.reduce((a, p) => a + p.actives + p.inactives, 0);

  return (
    <Page>
      <header className="max-w-[860px] pt-4 md:pt-10">
        <Link href="/#how-it-works" className="font-mono text-[12px] text-muted">
          ← Back to the overview
        </Link>
        <h1 className="m-0 mt-5 font-display text-[clamp(34px,5.4vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          The method, in full
        </h1>
        <p className="m-0 mt-4 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
          What the project used, how its four models were trained, and how to read each kind of
          result. Everything here is computational: no new patient or laboratory experiments were
          performed, and every candidate is a lead for laboratory testing.
        </p>
      </header>

      {/* The whole method in four figures. */}
      <ol className="amr-journey m-0 mt-10 grid list-none grid-cols-2 gap-px overflow-hidden rounded-card border border-rule bg-rule p-0 lg:grid-cols-4">
        <Journey i={0} value={n(labelled)} text="labelled laboratory records to learn from" glyph={1} />
        <Journey i={1} value="4" text="models, one per pathogen species" glyph={2} />
        <Journey i={2} value={n(figures.libraryPredictions)} text={`predictions for ${n(summary.medicines)} approved medicines`} glyph={3} />
        <Journey i={3} value={n(summary.candidates)} text="repurposing candidates, leads for the laboratory" glyph={5} accent />
      </ol>

      <div className="mt-4 grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-[calc(var(--header-h)+28px)] pt-16">
            <MethodsNav />
          </div>
        </aside>
        <div className="min-w-0">
      {/* How the models learned (moved here from the overview) ----------- */}
      <Section id="how-the-models-learned" title="How the models learned">
        <p className="m-0 -mt-2 mb-6 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">
          Four models, one for each pathogen, learned from published laboratory measurements. This
          is what they saw, how they learned, and what they are for.
        </p>
        <Training data={training} threshold={DISCOVERY_THRESHOLD_TEXT} />
      </Section>

      {/* What we used --------------------------------------------------- */}
      <Section id="sources" title="What we used">
        <ul className="m-0 grid list-none gap-px overflow-hidden rounded-card border border-rule bg-rule p-0 md:grid-cols-2 xl:grid-cols-3">
          <Source
            name="ChEMBL"
            glyph={1}
            role="Laboratory bioactivity records and molecular structures"
            figure={n(labelled)}
            unit="labelled laboratory records used for training"
            kind="experimental"
          />
          <Source
            name="Molecular structures"
            glyph={2}
            role="The broader molecular dataset the pipeline works from"
            figure={n(figures.validMolecules)}
            unit="valid structures, each stored as a fingerprint"
            kind="computational"
          />
          <Source
            name="FDA Orange Book"
            glyph={1}
            role="Which medicines are approved"
            figure={n(summary.medicines)}
            unit="approved medicines in the screening library"
            kind="clinical"
          />
          <Source
            name="ClinicalTrials.gov"
            glyph={5}
            role="Registered clinical-study history"
            figure={`${n(figures.registryChecked)} / ${n(summary.medicines)}`}
            unit={`medicines checked · ${n(summary.registeredStudies)} registered studies`}
            kind="clinical"
          />
          <Source
            name="Protein Data Bank (PDB)"
            glyph={4}
            role="3D protein structures for docking"
            figure={String(figures.targets.length)}
            unit={`targets: ${figures.targets.map((t) => `${t.name}${t.pdbId ? ` (${t.pdbId})` : ""}`).join("; ")}`}
            kind="computational"
          />
          <Source
            name="RDKit and AutoDock Vina"
            glyph={2}
            role="Software: RDKit processes and standardises structures; AutoDock Vina runs the docking"
            figure={n(figures.dockedMedicines)}
            unit="library medicines docked so far (a subset)"
            kind="computational"
          />
        </ul>
        <p className="m-0 mt-3 text-[13px] text-muted">
          The {n(figures.validMolecules)} molecular structures and the {n(summary.medicines)} approved
          medicines are different populations. They are never added together.
        </p>
      </Section>

      {/* How the training worked ------------------------------------------- */}
      <Section id="training" title="How the training worked, step by step">
        <div className="grid gap-4">
          <Phase name="Prepare the data" note="From published measurements to labelled examples">
            <Step n="01" title="Gather published measurements for each species" chip={n(labelled + training.ambiguous) + " records gathered"}>
            Laboratory records from ChEMBL for MRSA, <em>E. coli</em>, <em>K. pneumoniae</em> and{" "}
            <em>M. tuberculosis</em>: how much of a molecule it took to stop the pathogen growing.
            </Step>
            <Step n="02" title="Put every measurement on one scale">
            Records come in different units. Each is converted to a molar concentration, so a value in
            micrograms per millilitre and a value in micromolar can be compared. A record whose
            structure cannot be read is dropped rather than guessed.
            </Step>
            <Step n="03" title="Label each record, or leave it out" chip={n(labelled) + " kept, " + n(training.ambiguous) + " left out"}>
            Active if growth stopped at {LABEL_ACTIVE_MICROMOLAR} µM or less ({n(training.perPathogen.reduce((a, p) => a + p.actives, 0))}{" "}
            records). Inactive if it took {LABEL_INACTIVE_MICROMOLAR} µM or more (
            {n(training.perPathogen.reduce((a, p) => a + p.inactives, 0))}). In between is too close to
            call: {n(training.ambiguous)} records left out. A &ldquo;greater than&rdquo; measurement can
            only ever count as inactive, and a &ldquo;less than&rdquo; one only as active.
            </Step>
            <Step n="04" title="Describe each molecule as a fingerprint" chip={n(figures.validMolecules) + " fingerprints"}>
            Each structure is turned into a molecular fingerprint: a fixed-length pattern of
            structural features that lets a computer compare molecules.
            </Step>
          </Phase>
          <Phase name="Learn" note="One model per species, checked on molecules it has not seen">
            <Step n="05" title="Train one model per species" chip={"4 models"}>
            A machine-learning model learns which fingerprint features go with activity for that
            species. It learns from earlier laboratory observations; it does not simulate a patient.
            </Step>
            <Step n="06" title="Check it on molecules it has not seen">
            Part of the data is held back during training, and the model is judged on it. Molecules
            that share a core structure are kept on the same side of that split, so the check is not
            flattered by near-copies.
            </Step>
          </Phase>
          <Phase name="Use" note="Scoring the approved medicines, then setting aside what is already known">
            <Step n="07" title="Score every approved medicine" chip={n(figures.libraryPredictions) + " predictions"}>
            Each of the {n(summary.medicines)} medicines gets an AI-predicted activity for each of
            the four species ({n(figures.libraryPredictions)} predictions). {n(summary.withActivity)}{" "}
            reach {DISCOVERY_THRESHOLD_TEXT} for at least one species, a discovery filter rather than
            a clinical cutoff.
            </Step>
            <Step n="08" title="Set aside what is already an antimicrobial" chip={n(summary.candidates) + " candidates"}>
            Existing antimicrobials ({n(summary.existingAntibacterials)}) are identified from WHO ATC
            codes and FDA pharmacologic classes, never from a name. {n(summary.needsReview)} that
            neither source classifies are kept for review, not counted.{" "}
            <strong className="font-semibold text-computational">{n(summary.candidates)}</strong> repurposing
            candidates remain.
            </Step>
          </Phase>
        </div>
        <div className="mt-6 rounded-card border border-accent bg-raised p-5">
          <p className="m-0 font-display text-[15px] font-semibold text-ink">A known limit</p>
          <p className="m-0 mt-1.5 max-w-[75ch] text-[14px] leading-relaxed text-ink-2">
            Few training records name a resistant strain (
            {training.perPathogen
              .map((p) => {
                const t = p.actives + p.inactives;
                return `${p.label} ${t ? ((p.resistant / t) * 100).toFixed(1) : "0.0"}%`;
              })
              .join(", ")}
            ). The models therefore predict activity against the species, not against the resistant
            phenotype.
          </p>
        </div>
      </Section>

      {/* How to read a result -------------------------------------------- */}
      <Section id="reading" title="How to read a result">
        <div className="grid gap-4 lg:grid-cols-2">
          <Reading
            kind="computational"
            term="AI-predicted activity, e.g. 81%"
            means="How strongly the model expects the molecule to be active against that species in a laboratory test, given the patterns it learned."
            not="A chance of curing anyone, a measurement, or a statement about the resistant strain."
            how={`Compare medicines against the same species. ${DISCOVERY_THRESHOLD_TEXT} is where the site starts listing a medicine as worth a closer look.`}
          />
          <Reading
            kind="computational"
            term="Docking score, e.g. −9.7 kcal/mol"
            means="A computer estimate of how well the molecule fits one selected pathogen protein. More negative is a better fit."
            not="Proof that the molecule binds, or that it has an antimicrobial effect."
            how={`This project screens at ${DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol, its own target rather than a universal cutoff. Only a subset of medicines has been docked.`}
          />
          <Reading
            kind="clinical"
            term="Registered study"
            means="A study listed on ClinicalTrials.gov names the medicine."
            not="That the study succeeded, or that the medicine is approved for that use."
            how="Read the listed condition: most registered studies are for the medicine's existing use."
          />
          <Reading
            kind="experimental"
            term="Laboratory record"
            means="A measured result from a published laboratory test, recorded in ChEMBL."
            not="A clinical result. Laboratory activity does not show a medicine works in people."
            how="These are the measurements the models learned from, shown separately from any prediction."
          />
        </div>
        <dl className="m-0 mt-4 grid gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3">
          <State kind="none" term="No evidence found">
            The source was searched and nothing matched. It is not the same as &ldquo;does not work&rdquo;.
          </State>
          <State kind="unchecked" term="Not yet checked">
            The source has not been searched for this medicine yet.
          </State>
          <State term="No effect" glyph="≠">
            A different statement altogether, which needs actual negative evidence. This site never
            makes it.
          </State>
        </dl>
      </Section>

        </div>
      </div>

      {/* How new medicines get their scores. */}
      <section aria-labelledby="worker-h" className="mt-16 rounded-card border border-rule bg-raised p-5 md:p-7">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
          <div>
            <h2 id="worker-h" className="m-0 font-display text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.02em] text-ink">
              How newly approved medicines are scored
            </h2>
            <p className="m-0 mt-3 text-[14px] leading-relaxed text-ink-2">
              A self-hosted update worker, run separately from this website, checks the FDA Orange
              Book and ChEMBL for newly approved medicines, scores each new one with the same four
              trained models, and publishes the results here. It runs on demand as a batch job.
            </p>
          </div>
          <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {[
              ["Finds", "new approved medicines and their structures"],
              ["Scores", "each with the four trained models; it never retrains on new data"],
              ["Checks itself", "model files are checksum-verified and a known-answer test runs on every start"],
              ["Publishes", "the new predictions to the database this site reads"],
            ].map(([verb, text], i) => (
              <li key={verb} className="flex gap-3 rounded-card border border-rule-soft bg-paper p-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent font-mono text-[11px] text-accent">
                  {i + 1}
                </span>
                <span className="text-[13px] leading-snug text-ink-2">
                  <strong className="font-display font-semibold text-ink">{verb}</strong> {text}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 mt-5 border-t border-rule-soft pt-4 text-[13px] leading-relaxed text-muted">
          The worker does not yet classify new medicines as antimicrobial or not. Until that step
          runs, a new medicine reads &ldquo;not yet checked&rdquo; and is not counted as a
          repurposing candidate.
        </p>
      </section>

      {/* The code behind it. */}
      <section aria-labelledby="code-h" className="mt-16 flex flex-wrap items-center justify-between gap-5 rounded-card border border-ink bg-raised px-5 py-5 md:px-7">
        <div>
          <h2 id="code-h" className="m-0 font-display text-[18px] font-semibold text-ink">
            The code behind it
          </h2>
          <p className="m-0 mt-1 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">
            The pipeline, the models&rsquo; training, the checks and this website are in one public
            repository on GitHub.
          </p>
        </div>
        <a
          href="https://github.com/VED2107/amr-drug-repurposing"
          target="_blank"
          rel="noreferrer"
          className="amr-btn-quiet"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          github.com/VED2107/amr-drug-repurposing <span data-arrow aria-hidden="true">↗</span>
        </a>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/dashboard" className="amr-btn">
          Open the dashboard <span data-arrow aria-hidden="true">→</span>
        </Link>
        <Link href="/" className="amr-btn-quiet">
          Back to the overview
        </Link>
      </div>
    </Page>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-16 scroll-mt-[calc(var(--header-h)+16px)]">
      <h2 id={`${id}-h`} className="m-0 font-display text-[clamp(24px,2.8vw,34px)] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Source({
  name,
  role,
  figure,
  unit,
  kind,
  glyph,
}: {
  name: string;
  role: string;
  figure: string;
  unit: string;
  kind: "experimental" | "computational" | "clinical";
  glyph: number;
}) {
  return (
    <li className="amr-source flex flex-col gap-2 bg-raised p-5">
      <div className="amr-glyph-slot mb-1 flex h-14 items-center rounded-card bg-paper px-3">
        <StageGlyph stage={glyph} />
      </div>
      <span className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        <EvidenceIcon kind={kind} size={11} />
        {name}
      </span>
      <span className="text-[13px] leading-snug text-ink-2">{role}</span>
      <span className="mt-auto pt-2 font-mono text-[24px] tabular-nums leading-none text-ink">{figure}</span>
      <span className="text-[12px] leading-snug text-muted">{unit}</span>
    </li>
  );
}

function Phase({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-raised p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule-soft pb-3">
        <h3 className="m-0 font-display text-[18px] font-semibold text-ink">{name}</h3>
        <p className="m-0 text-[13px] text-muted">{note}</p>
      </div>
      <ol className="m-0 mt-4 grid list-none gap-x-6 gap-y-5 p-0 md:grid-cols-2">{children}</ol>
    </section>
  );
}

function Step({ n: num, title, chip, children }: { n: string; title: string; chip?: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-accent bg-paper font-mono text-[12px] text-accent">
        {num}
      </span>
      <div className="pt-1">
        <h4 className="m-0 font-display text-[16px] font-semibold leading-snug text-ink">{title}</h4>
        {chip ? (
          <p className="m-0 mt-1.5 inline-block rounded-full bg-sunken px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-ink">
            {chip}
          </p>
        ) : null}
        <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </li>
  );
}

function Journey({
  i,
  value,
  text,
  glyph,
  accent = false,
}: {
  i: number;
  value: string;
  text: string;
  glyph: number;
  accent?: boolean;
}) {
  return (
    <li className="amr-journey-step relative flex flex-col gap-3 bg-raised p-5" style={{ ["--i" as string]: i }}>
      <div className="amr-glyph-slot flex h-12 items-center">
        <StageGlyph stage={glyph} />
      </div>
      <span className={`font-mono text-[clamp(26px,2.8vw,36px)] tabular-nums leading-none ${accent ? "text-computational" : "text-ink"}`}>
        {value}
      </span>
      <span className="text-[13px] leading-snug text-ink-2">{text}</span>
      {i < 3 ? (
        <span aria-hidden="true" className="amr-journey-arrow absolute right-4 top-5 hidden font-mono text-[16px] text-accent lg:block">
          →
        </span>
      ) : null}
    </li>
  );
}

function Reading({
  kind,
  term,
  means,
  not,
  how,
}: {
  kind: "computational" | "clinical" | "experimental";
  term: string;
  means: string;
  not: string;
  how: string;
}) {
  return (
    <div className="flex flex-col rounded-card border border-rule bg-raised p-5 md:p-6">
      <p className="m-0 flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
        <EvidenceIcon kind={kind} />
        {term}
      </p>
      <p className="m-0 mt-3 text-[14px] leading-relaxed text-ink">
        <span className="font-semibold">Means:</span> {means}
      </p>
      <p className="m-0 mt-2 text-[14px] leading-relaxed text-ink">
        <span className="font-semibold">Does not mean:</span> {not}
      </p>
      <p className="m-0 mt-auto border-t border-rule-soft pt-3 text-[13px] leading-relaxed text-ink-2 [margin-top:0.9rem]">
        {how}
      </p>
    </div>
  );
}

function State({
  kind,
  term,
  glyph,
  children,
}: {
  kind?: "none" | "unchecked";
  term: string;
  glyph?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-raised p-5">
      <dt className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        {kind ? <EvidenceIcon kind={kind} /> : <span className="font-display text-[18px] leading-none">{glyph}</span>}
        {term}
      </dt>
      <dd className="m-0 mt-2 text-[14px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  );
}
