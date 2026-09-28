import Link from "next/link";

import { EvidenceIcon } from "@/components/investigate";
import { Page } from "@/components/primitives";
import { InvestigateSearch } from "@/components/search/InvestigateSearch";
import { PATHOGEN_PLAIN, REPURPOSING_EXAMPLES } from "@/lib/content";
import { conditionForPathogen, getDashboardSummary } from "@/lib/queries/investigate";
import { DISCOVERY_THRESHOLD_TEXT, DOCKING_SCREENING_TARGET_KCAL_MOL } from "@/lib/science";

export const dynamic = "force-dynamic";

/**
 * The overview: what this project is, in the words a pharmacy student uses,
 * and how to read what the dashboard shows. Every count is read live.
 */
export default async function Overview() {
  const summary = await getDashboardSummary();
  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <Page>
      {/* --- Opening ---------------------------------------------------- */}
      <section className="grid gap-10 pt-2 md:pt-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <h1 className="m-0 max-w-[16ch] text-balance font-display text-[clamp(38px,6.4vw,84px)] font-semibold leading-[0.98] tracking-[-0.035em] text-ink">
            Old medicines, new questions.
          </h1>
          <p className="m-0 mt-6 max-w-[58ch] text-[17px] leading-relaxed text-ink-2">
            Bacteria are becoming resistant to the antibiotics we rely on, and new antibiotics
            take many years to develop. This project asks a faster question: could a medicine that
            is <strong className="font-semibold text-ink">already approved</strong> for something
            else also act against a drug-resistant bacterium?
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="amr-btn">
              Open the dashboard <span data-arrow aria-hidden="true">→</span>
            </Link>
            <Link href="/investigate?condition=Tuberculosis" className="amr-btn-quiet">
              Try an example: tuberculosis
            </Link>
          </div>
        </div>

        <dl className="m-0 grid gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-1">
          <Stat value={n(summary.medicines)} label="approved medicines checked" />
          <Stat
            value={n(summary.withActivity)}
            label={`with AI-predicted activity ${DISCOVERY_THRESHOLD_TEXT} against at least one bacterium`}
            accent
          />
          <Stat value={n(summary.registeredStudies)} label="registered clinical studies linked to them" />
        </dl>
      </section>

      {/* --- Repurposing -------------------------------------------------- */}
      <Chapter
        title="What is drug repurposing?"
        lede="Finding a new use for a medicine that is already approved. Its safety in people is already known, so testing a new use can be faster and cheaper than starting from nothing."
      >
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
          {REPURPOSING_EXAMPLES.map((e) => (
            <li key={e.name} className="rounded-card border border-rule bg-raised p-5">
              <p className="m-0 font-display text-[18px] font-semibold text-ink">{e.name}</p>
              <p className="m-0 mt-3 text-[13px] text-muted">First used for</p>
              <p className="m-0 text-[14px] text-ink-2">{e.from}</p>
              <p className="m-0 mt-2 text-[13px] text-muted">Later also used for</p>
              <p className="m-0 text-[14px] text-ink">{e.to}</p>
            </li>
          ))}
        </ul>
      </Chapter>

      {/* --- How it works ------------------------------------------------ */}
      <Chapter
        title="How this site works"
        lede="Four steps, from the list of approved medicines to a short list worth a closer look."
      >
        <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-4">
          <Step n={1} title="Start with approved medicines">
            {n(summary.medicines)} medicines from the FDA Orange Book, each matched to its chemical
            structure.
          </Step>
          <Step n={2} title="Let the model compare structures">
            For each bacterium, a computer model compares the medicine&rsquo;s structure with
            molecules already tested in the laboratory. The result is an{" "}
            <strong className="font-semibold text-ink">AI-predicted activity</strong> from 0 to 100%.
          </Step>
          <Step n={3} title="Check what is already known">
            Registered clinical studies (ClinicalTrials.gov) and laboratory measurements (ChEMBL)
            are shown separately from the prediction, with links to the original records.
          </Step>
          <Step n={4} title="Look at what is new">
            Medicines with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT} that have no documented
            evidence for the condition are listed as{" "}
            <em>other medicines to investigate</em>.
          </Step>
        </ol>
      </Chapter>

      {/* --- Bacteria ------------------------------------------------------ */}
      <Chapter
        title="The four bacteria with a model"
        lede="Only these four can show a percentage. Any other condition shows documented evidence only."
      >
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {summary.pathogens.map((p) => (
            <li key={p.key}>
              <Link
                href={`/investigate?condition=${encodeURIComponent(conditionForPathogen(p.key))}`}
                className="amr-card group flex h-full flex-col gap-3 rounded-card border border-rule bg-raised p-5 no-underline"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-[20px] font-semibold text-ink">{p.label}</span>
                  <span className="text-[13px] italic text-muted">{p.fullName}</span>
                </span>
                <span className="text-[14px] leading-relaxed text-ink-2">{PATHOGEN_PLAIN[p.key].plain}</span>
                <span className="text-[13px] leading-relaxed text-muted">
                  How it resists: {PATHOGEN_PLAIN[p.key].mechanism}
                </span>
                <span className="mt-auto flex flex-wrap items-baseline justify-between gap-3 border-t border-rule-soft pt-3">
                  <span className="text-[13px] text-ink-2">
                    <span className="font-mono text-[18px] font-medium tabular-nums text-computational">
                      {n(p.medicines)}
                    </span>{" "}
                    medicines with AI-predicted activity {DISCOVERY_THRESHOLD_TEXT}
                  </span>
                  <span className="text-[13px] font-medium text-ink decoration-accent underline-offset-4 group-hover:underline">
                    Investigate →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Chapter>

      {/* --- Reading a result --------------------------------------------- */}
      <Chapter
        title="How to read a result"
        lede="Every result says which kind of evidence it is. These are the words and marks you will see."
      >
        <dl className="m-0 grid gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-2">
          <Term kind="computational" term="AI-predicted activity, e.g. 81%">
            How strongly the model expects the molecule to be active against the bacterium in a
            laboratory test. It is a prediction, not a measurement, and not a chance of curing
            anyone.
          </Term>
          <Term kind="clinical" term="Registered study">
            A study listed on ClinicalTrials.gov that names the medicine. Registration describes a
            study; it does not mean the study worked.
          </Term>
          <Term kind="experimental" term="Laboratory record">
            A measured result from a published lab test (for example a minimum inhibitory
            concentration), recorded in ChEMBL.
          </Term>
          <Term kind="computational" term={`Docking score, e.g. −9.7 kcal/mol`}>
            A computer estimate of how well the molecule fits a bacterial protein. More negative
            fits better. This project screens at {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)}{" "}
            kcal/mol; a good fit is not proof that it binds.
          </Term>
          <Term kind="none" term="No evidence found">
            The source was searched and nothing matched. That is not the same as &ldquo;does not
            work&rdquo;.
          </Term>
          <Term kind="unchecked" term="Not yet checked">
            The source has not been searched for this medicine yet.
          </Term>
        </dl>
      </Chapter>

      {/* --- Limits ------------------------------------------------------ */}
      <Chapter title="What this site cannot tell you">
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {[
            "Whether a medicine will treat an infection in a patient. Only clinical trials can show that.",
            "Whether a medicine is safe at the dose an infection would need.",
            "Whether it works against the resistant strain specifically. The data behind the models rarely records resistant strains, so predictions describe the bacterial species.",
            "Whether a medicine is approved for a new use. FDA approval covers the use it was approved for.",
          ].map((line) => (
            <li key={line} className="flex gap-3 rounded-card border border-rule bg-raised p-4 text-[14px] leading-relaxed text-ink-2">
              <span className="mt-1.5">
                <EvidenceIcon kind="none" size={12} />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </Chapter>

      {/* --- Start ---------------------------------------------------------- */}
      <section className="mt-20 rounded-card border border-rule bg-raised p-6 md:p-10">
        <h2 className="m-0 font-display text-[clamp(24px,3vw,36px)] font-semibold tracking-[-0.02em] text-ink">
          Start investigating
        </h2>
        <p className="m-0 mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          Search a condition to see the medicines already documented for it and the other medicines
          the model surfaces, or search a medicine to see all four of its predictions.
        </p>
        <div className="mt-6 max-w-[760px]">
          <InvestigateSearch />
        </div>
      </section>
    </Page>
  );
}

function Stat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="bg-raised p-5">
      <dt className="sr-only">{label}</dt>
      <dd className="m-0">
        <span
          className="block font-mono text-[clamp(28px,3.2vw,40px)] font-medium tabular-nums leading-none"
          style={{ color: accent ? "var(--color-computational)" : "var(--color-ink)" }}
        >
          {value}
        </span>
        <span className="mt-2 block text-[14px] leading-snug text-ink-2">{label}</span>
      </dd>
    </div>
  );
}

function Chapter({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <h2 className="m-0 font-display text-[clamp(26px,3.2vw,40px)] font-semibold tracking-[-0.025em] text-ink">
        {title}
      </h2>
      {lede ? <p className="m-0 mt-3 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">{lede}</p> : null}
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-5">
      <span className="font-mono text-[13px] tabular-nums text-accent">Step {n}</span>
      <span className="font-display text-[17px] font-semibold leading-snug text-ink">{title}</span>
      <span className="text-[14px] leading-relaxed text-ink-2">{children}</span>
    </li>
  );
}

function Term({
  kind,
  term,
  children,
}: {
  kind: "clinical" | "experimental" | "computational" | "none" | "unchecked";
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-raised p-5">
      <dt className="flex items-center gap-2.5 font-display text-[16px] font-semibold text-ink">
        <EvidenceIcon kind={kind} />
        {term}
      </dt>
      <dd className="m-0 mt-2 text-[14px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  );
}
