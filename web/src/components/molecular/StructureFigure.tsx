import { renderStructure } from "@/lib/structure";

/**
 * The drawn form of a medicine, beside the string the models were given.
 *
 * Two states only, and they are different statements. A depiction means RDKit
 * parsed this record's own SMILES. "No depiction" means this record has no
 * usable structure — a gap in the structure match, not a property of the
 * medicine — and it is said in words rather than filled with a generic
 * skeleton. The picture carries no claim about activity.
 */
export async function StructureFigure({
  smiles,
  caption,
  label,
  width = 460,
  height = 320,
  annotateStereo = true,
}: {
  smiles: string | null | undefined;
  /** Sits under the frame; says what the depiction is, not what it proves. */
  caption?: string;
  /** Accessible name — the medicine or scaffold being drawn. */
  label: string;
  width?: number;
  height?: number;
  annotateStereo?: boolean;
}) {
  const structure = await renderStructure(smiles, { width, height, annotateStereo });

  return (
    <figure className="m-0">
      <div
        className="grid place-items-center border border-rule bg-raised p-4"
        style={{ minHeight: `${Math.round(height * 0.62)}px` }}
      >
        {structure === null ? (
          <p className="m-0 max-w-[34ch] text-center text-[12px] leading-relaxed text-muted">
            No depiction. This record has no structure RDKit can read, so nothing is
            drawn here.
          </p>
        ) : (
          <div
            role="img"
            aria-label={`Two-dimensional structure of ${label}`}
            className="amr-structure w-full text-ink"
            style={{ maxWidth: `${width}px` }}
            /* RDKit output, generated server-side from this record's own SMILES. */
            dangerouslySetInnerHTML={{ __html: structure.svg }}
          />
        )}
      </div>
      {caption ? (
        <figcaption className="m-0 mt-2 text-[12px] leading-relaxed text-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
