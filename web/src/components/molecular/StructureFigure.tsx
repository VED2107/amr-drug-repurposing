/**
 * The drawn form of a medicine.
 *
 * Two states only, and they are different statements. A drawing means this
 * record's own structure was read and depicted. "No drawing" means the record
 * has no usable structure (a gap in the data, not a property of the medicine),
 * and it is said in words rather than filled with a generic skeleton. The
 * picture carries no claim about activity.
 *
 * The drawing is an image served by `/api/structure/[moleculeId]`, so the
 * browser loads it once, caches it, and a page does not carry it inline.
 */
export function StructureFigure({
  moleculeId,
  hasStructure,
  label,
  compact = false,
  priority = false,
}: {
  moleculeId: string;
  /** Whether the database holds a valid structure for this medicine. */
  hasStructure: boolean;
  /** Accessible name: the medicine being drawn. */
  label: string;
  /** A thumbnail: no frame, no caption, no stereo labels. */
  compact?: boolean;
  /** The page's main figure: fetched early rather than on scroll. */
  priority?: boolean;
}) {
  const size = compact ? { w: 184, h: 140, q: "sm" } : { w: 420, h: 300, q: "lg" };
  const src = `/api/structure/${encodeURIComponent(moleculeId)}?size=${size.q}`;

  const image = (
    // A plain <img>: the SVG is already the right size and cached for a long
    // time, so there is nothing for an image optimiser to do.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Chemical structure of ${label}`}
      width={size.w}
      height={size.h}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      className="block h-auto w-full"
      style={{ maxWidth: `${size.w}px` }}
    />
  );

  if (compact) return hasStructure ? image : null;

  return (
    <figure className="m-0">
      <p className="m-0 mb-2 font-display text-[14px] font-semibold text-ink">Chemical structure</p>
      <div
        className="grid place-items-center rounded-card border border-rule bg-raised p-4"
        style={{ aspectRatio: `${size.w} / ${size.h}` }}
      >
        {hasStructure ? (
          image
        ) : (
          <p className="m-0 max-w-[30ch] text-center text-[13px] leading-relaxed text-muted">
            No structure drawing is available for this medicine.
          </p>
        )}
      </div>
      <figcaption className="m-0 mt-2 text-[12px] leading-relaxed text-muted">
        A drawing shows what the molecule is, not what it does.
      </figcaption>
    </figure>
  );
}
