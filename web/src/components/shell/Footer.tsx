/**
 * Where the records come from, and the one sentence every page owes its
 * reader. Nothing about how the software is built.
 */

const SOURCES = ["FDA Orange Book", "ChEMBL", "ClinicalTrials.gov", "Protein Data Bank"];

export function Footer() {
  return (
    <footer className="border-t border-rule bg-paper">
      <div className="mx-auto flex max-w-shell flex-col gap-2 px-4 py-6 md:px-8 lg:px-12">
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">Research prototype, not medical advice.</strong>{" "}
          Nothing here shows that a medicine treats a disease.
        </p>
        <p className="m-0 font-mono text-[11px] text-muted">Sources: {SOURCES.join(" · ")}</p>
      </div>
    </footer>
  );
}
