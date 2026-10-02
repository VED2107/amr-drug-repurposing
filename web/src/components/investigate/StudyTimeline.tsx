/**
 * When the registered studies began: one bar per start year, for whatever the
 * list below is showing. It describes registrations, not results: a tall
 * year means many studies started, not that anything worked.
 */
export function StudyTimeline({ data, total }: { data: { year: number; n: number }[]; total: number }) {
  if (data.length < 2) return null;
  const first = data[0].year;
  const last = data[data.length - 1].year;
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const byYear = new Map(data.map((d) => [d.year, d.n]));
  const max = Math.max(1, ...data.map((d) => d.n));
  const peak = data.reduce((a, d) => (d.n > a.n ? d : a), data[0]);
  const dated = data.reduce((a, d) => a + d.n, 0);
  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <figure className="m-0 mb-5 rounded-card border border-rule bg-raised px-4 pb-3 pt-4 md:px-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-display text-[14px] font-semibold text-ink">When these studies started</span>
        <span className="font-mono text-[11px] text-muted">
          {n(dated)} of {n(total)} have a start date · most in {peak.year} ({n(peak.n)})
        </span>
      </figcaption>
      <div className="amr-timeline mt-4 flex h-[84px] items-end gap-[2px]" aria-hidden="true">
        {years.map((y, i) => {
          const v = byYear.get(y) ?? 0;
          return (
            <span
              key={y}
              title={`${y}: ${n(v)} ${v === 1 ? "study" : "studies"}`}
              className="amr-timeline-bar block flex-1"
              style={{ height: `${v ? Math.max(3, (v / max) * 100) : 0}%`, ["--i" as string]: i }}
              data-peak={y === peak.year ? "" : undefined}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted">
        <span>{first}</span>
        <span>{Math.round((first + last) / 2)}</span>
        <span>{last}</span>
      </div>
    </figure>
  );
}
