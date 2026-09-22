import {
  ACTIVITY_LABEL,
  activityBand,
  assertHonestLabel,
  formatProbability,
  mayShowProbability,
  NO_MODEL_NOTICE,
  TRAINING_DATA_DISCLOSURE,
} from "@/lib/science";
import type { PathogenKey } from "@/lib/types";

/**
 * A model probability, or an explicit statement of why there is no number.
 *
 * This component is the percentage gate. It cannot render a bare figure: the
 * label is baked in, and a caller that supplies its own label has it checked
 * against the forbidden list. A condition with no model returns the
 * "no model exists" notice instead of a number — there is no fallback value.
 */
export function ActivityIndicator({
  pathogenKey,
  probability,
  modelVersion,
  inTrainingData,
  trainingSplit,
  label = ACTIVITY_LABEL,
  showBar = true,
  showBand = true,
}: {
  pathogenKey: PathogenKey | null;
  probability: number | null;
  modelVersion?: string | null;
  /** Three-valued: true, false, or null for "membership unknown". */
  inTrainingData?: boolean | null;
  trainingSplit?: string | null;
  label?: string;
  showBar?: boolean;
  showBand?: boolean;
}) {
  assertHonestLabel(label);

  if (!mayShowProbability(pathogenKey, probability)) {
    return (
      <p className="m-0 max-w-[60ch] text-[12px] leading-relaxed text-muted">
        {pathogenKey === null ? NO_MODEL_NOTICE : "No prediction available."}
      </p>
    );
  }

  const band = activityBand(probability);
  const color =
    band.kind === "prediction" ? "var(--color-computational)" : "var(--color-muted)";
  const fraction = Math.max(0, Math.min(1, probability));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span
          className="font-mono text-[18px] font-semibold tabular-nums"
          style={{ color }}
        >
          {formatProbability(probability)}
        </span>
        <span className="text-right text-[11px] text-muted">{label}</span>
      </div>

      {showBar ? (
        <div
          className="mt-1.5 h-[3px] w-full bg-sunken"
          role="img"
          aria-label={`${formatProbability(probability)} ${label}`}
        >
          <div
            className="h-full origin-left"
            style={{ width: `${(fraction * 100).toFixed(2)}%`, background: color }}
          />
        </div>
      ) : null}

      {showBand ? (
        <p className="m-0 mt-1.5 text-[12px] text-ink-2">{band.wording}</p>
      ) : null}

      {modelVersion ? (
        <p className="m-0 mt-1 font-mono text-[10px] text-fainter">model {modelVersion}</p>
      ) : null}

      {inTrainingData === true ? (
        <p className="m-0 mt-2 border-l-2 border-none pl-2.5 text-[12px] leading-relaxed text-none">
          {TRAINING_DATA_DISCLOSURE}
          {trainingSplit ? ` Split: ${trainingSplit}.` : null}
        </p>
      ) : inTrainingData === null ? (
        <p className="m-0 mt-2 text-[11px] leading-relaxed text-muted">
          Training-data membership could not be established for this prediction, which is
          not the same as the molecule being absent from it.
        </p>
      ) : (
        <p className="m-0 mt-2 text-[11px] leading-relaxed text-muted">
          This molecule was not in the model&rsquo;s training data.
        </p>
      )}
    </div>
  );
}
