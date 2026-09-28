import { renderStructure } from "@/lib/structure";

/**
 * The drawn form of a medicine.
 *
 * Two states only, and they are different statements. A drawing means this
 * record's own structure was read and depicted server-side. "No drawing" means
 * the record has no usable structure — a gap in the data, not a property of
 * the medicine — and it is said in words rather than filled with a generic
 * skeleton. The picture carries no claim about activity.
 */
export async function StructureFigure({
  smiles,
  label,
  width = 460,
  height = 320,
  compact = false,
}: {
  smiles: string | null | undefined;
  /** Accessible name — the medicine being drawn. */
  label: string;
  width?: number;
  height?: number;
  /** A thumbnail: no frame, no caption, no stereo labels. */
  compact?: boolean;
}) {
  const structure = await renderStructure(smiles, {
    width,
    height,
    annotateStereo: !compact,
  });

  if (compact) {
    return structure === null ? null : (
      <div
        role="img"
        aria-label={`Chemical structure of ${label}`}
        className="amr-structure w-full text-ink"
        style={{ maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }}
        dangerouslySetInnerHTML={{ __html: structure.svg }}
      />
    );
  }

  return (
    <figure className="m-0">
      <p className="m-0 mb-2 font-display text-[14px] font-semibold text-ink">Chemical structure</p>
      <div
        className="grid place-items-center rounded-card border border-rule bg-raised p-4"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {structure === null ? (
          <p className="m-0 max-w-[30ch] text-center text-[13px] leading-relaxed text-muted">
            No structure drawing is available for this medicine.
          </p>
        ) : (
          <div
            role="img"
            aria-label={`Chemical structure of ${label}`}
            className="amr-structure w-full text-ink"
            style={{ maxWidth: `${width}px` }}
            dangerouslySetInnerHTML={{ __html: structure.svg }}
          />
        )}
      </div>
      <figcaption className="m-0 mt-2 text-[12px] leading-relaxed text-muted">
        A drawing shows what the molecule is, not what it does.
      </figcaption>
    </figure>
  );
}
