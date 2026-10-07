/**
 * How the repurposing candidates are counted, as a breaking pill.
 *
 * The first row is one long capsule: the whole approved-medicine library.
 * Each row after it keeps a shorter capsule, and the medicines that leave at
 * that step snap off as a separate piece, labelled with how many and why.
 * Lengths are proportional to counts on one scale, so the kept capsule and the
 * broken-off piece always add back up to the row above.
 */

interface Props {
  medicines: number;
  withActivity: number;
  existingAntibacterials: number;
  needsReview: number;
  candidates: number;
  threshold: string;
}

export function CandidateFlow(p: Props) {
  const n = (v: number) => v.toLocaleString("en-GB");
  const pct = (v: number) => `${p.medicines ? (v / p.medicines) * 100 : 0}%`;
  const afterAnti = p.withActivity - p.existingAntibacterials;

  const rows: {
    value: number;
    label: string;
    tone: string;
    piece?: { value: number; label: string; tone: string };
  }[] = [
    { value: p.medicines, label: "approved medicines", tone: "amr-pill-ink" },
    {
      value: p.withActivity,
      label: `with AI-predicted activity ${p.threshold} against at least one pathogen`,
      tone: "amr-pill-c1",
      piece: { value: p.medicines - p.withActivity, label: `below ${p.threshold}, not counted`, tone: "amr-pill-grey" },
    },
    {
      value: afterAnti,
      label: "not already antimicrobials",
      tone: "amr-pill-c2",
      piece: {
        value: p.existingAntibacterials,
        label: "already antimicrobials, set aside",
        tone: "amr-pill-ochre",
      },
    },
    {
      value: p.candidates,
      label: "repurposing candidates",
      tone: "amr-pill-c3",
      piece: {
        value: p.needsReview,
        label: "needing review, kept in the library",
        tone: "amr-pill-review",
      },
    },
  ];

  return (
    <ol className="amr-breaks m-0 flex list-none flex-col gap-5 p-0">
      {rows.map((r, i) => (
        <li
          key={r.label}
          style={{ ["--i" as string]: i }}
          className="grid items-start gap-x-6 gap-y-2 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
        >
          <p className="m-0 flex flex-wrap items-baseline gap-x-2">
            <span
              className={`font-mono text-[20px] font-medium tabular-nums leading-none ${
                i === rows.length - 1 ? "text-computational" : "text-ink"
              }`}
            >
              {n(r.value)}
            </span>
            <span className="text-[12px] leading-snug text-ink-2">{r.label}</span>
          </p>
          <div className="flex min-w-0 items-start pt-1">
            <span className={`amr-pill ${r.tone}`} style={{ width: pct(r.value) }} />
            {r.piece ? (
              <span className="amr-piece-wrap ml-2 flex min-w-0 flex-col" style={{ width: pct(r.piece.value) }}>
                <span className={`amr-pill amr-piece ${r.piece.tone}`} />
                <span className="mt-2.5 hidden whitespace-nowrap text-[12px] leading-none text-ink-2 md:block">
                  <span className="font-mono tabular-nums text-ink">{`− ${n(r.piece.value)}`}</span> {r.piece.label}
                </span>
              </span>
            ) : null}
          </div>
          {r.piece ? (
            <p className="m-0 text-[12px] leading-snug text-ink-2 md:hidden">
              <span className="font-mono tabular-nums text-ink">{`− ${n(r.piece.value)}`}</span> {r.piece.label}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
