import {
  ACTIVITY_LABEL,
  activityBand,
  formatProbability,
  mayShowProbability,
} from "@/lib/science";
import type { PathogenKey } from "@/lib/types";

/**
 * A model probability inside a dense table row.
 *
 * The full `ActivityIndicator` carries its label, its band and its
 * training-data disclosure, which is right on a detail page and unreadable in a
 * table. This is the compact form: the column header supplies the label in
 * print, `aria-label` supplies it in speech, and the gate is the same one — a
 * pathogen without a model, or a medicine without a prediction, gets an em dash
 * and a reason, never a substituted number.
 */
export function ActivityCell({
  pathogenKey,
  probability,
  inTrainingData,
  reason = "no prediction",
}: {
  pathogenKey: PathogenKey | null;
  probability: number | null;
  /** Three-valued: true, false, or null for "membership unknown". */
  inTrainingData?: boolean | null;
  /** Why there is no number, when there is no number. */
  reason?: string;
}) {
  if (!mayShowProbability(pathogenKey, probability)) {
    return (
      <span className="font-mono text-[12px] text-fainter" title={reason}>
        — <span className="sr-only">{reason}</span>
      </span>
    );
  }

  const band = activityBand(probability);
  const color = band.kind === "prediction" ? "var(--color-computational)" : "var(--color-muted)";

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="font-mono text-[13px] font-medium tabular-nums"
        style={{ color }}
        aria-label={`${formatProbability(probability)} ${ACTIVITY_LABEL}, ${band.wording}`}
      >
        {formatProbability(probability)}
      </span>
      {inTrainingData === true ? (
        <abbr
          title="In the model's training data: recall, not an unseen prediction."
          className="cursor-help font-mono text-[10px] no-underline"
          style={{ color: "var(--color-none)" }}
        >
          trained
        </abbr>
      ) : null}
    </span>
  );
}

/**
 * The same value as a bar, for the matrix where four of them sit side by side.
 * The bar is redundant with the figure: it is a scanning aid, never the only
 * carrier of the value.
 */
export function ActivityBar({
  pathogenKey,
  probability,
}: {
  pathogenKey: PathogenKey | null;
  probability: number | null;
}) {
  if (!mayShowProbability(pathogenKey, probability)) return null;
  const fraction = Math.max(0, Math.min(1, probability));
  const band = activityBand(probability);
  const color = band.kind === "prediction" ? "var(--color-computational)" : "var(--color-muted)";
  return (
    <span aria-hidden="true" className="mt-1.5 block h-[2px] w-full bg-sunken">
      <span
        className="block h-full"
        style={{ width: `${(fraction * 100).toFixed(2)}%`, background: color }}
      />
    </span>
  );
}
