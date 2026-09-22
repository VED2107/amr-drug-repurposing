import Link from "next/link";

import { SearchField } from "@/components/search/SearchField";

import {
  Field,
  FilterChips,
  TableWrap,
  Td,
  Th,
  Tr,
  inputClass,
} from "@/components/data";
import { ActivityBar, ActivityCell } from "@/components/evidence/ActivityCell";
import { EvidenceIndicator } from "@/components/evidence/EvidenceIndicator";
import {
  Breadcrumb,
  EmptyState,
  LimitationCallout,
  Page,
  PageHeader,
  Section,
  num,
} from "@/components/primitives";
import { getPathogens } from "@/lib/queries/core";
import { getCandidateMatrix } from "@/lib/queries/screening";
import { ACTIVITY_LABEL, RESISTANCE_LIMITATION } from "@/lib/science";
import { firstValue, numberParam, withParams, type RawSearchParams } from "@/lib/url";
import { PATHOGEN_KEYS, type PathogenKey } from "@/lib/types";

/*
  Rendered per request rather than prerendered at build time.

  Every page here reads live counts from Supabase. Prerendering them made the
  *build* depend on reaching the database, which meant a deployment could fail
  for a reason that has nothing to do with the code — a connection string, a
  network route, a paused project. Rendering on request keeps the build a pure
  function of the repository, and has the side benefit that a figure is never
  older than the request that asked for it.
*/
export const dynamic = "force-dynamic";

const PATH = "/candidates";

/**
 * Candidate Explorer.
 *
 * One medicine, four models, side by side. The point of the matrix is that the
 * four numbers do not combine: there is no summary column, no total and no
 * "best candidate", because each probability belongs to a different model
 * trained on a different pathogen's data. A medicine that scores high against
 * M. tuberculosis and low against E. coli has not been ranked — it has been
 * described twice.
 *
 * That principle decides the row order too. The default is alphabetical.
 * Ordering by the highest value a medicine reaches in any column would rank it
 * on the strength of whichever model happened to score it highest, which is a
 * claim none of the four models makes. A reader can still sort by a named
 * column — that orders by one model's output, and the header says which.
 */
export default async function CandidatesPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;
  const search = firstValue(params, "q")?.trim() ?? "";
  const minProbability = numberParam(params, "min");
  const limit = Math.min(200, Math.max(10, numberParam(params, "limit") ?? 40));

  // Only a named pathogen column may order the table; anything else is
  // alphabetical. There is deliberately no "overall" or "highest" option.
  const sortParam = firstValue(params, "sortBy") ?? "";
  const sortPathogen = PATHOGEN_KEYS.includes(sortParam as PathogenKey)
    ? (sortParam as PathogenKey)
    : null;

  const [pathogens, rows] = await Promise.all([
    getPathogens(),
    getCandidateMatrix({ search: search || undefined, minProbability, limit, sortPathogen }),
  ]);

  const labelFor = (key: string) => pathogens.find((p) => p.key === key)?.label ?? key;

  const chips: { label: string; clear: Record<string, null> }[] = [];
  if (search) chips.push({ label: `name contains “${search}”`, clear: { q: null } });
  if (minProbability !== undefined)
    chips.push({ label: `reaches ${minProbability} somewhere`, clear: { min: null } });

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Screen", "Candidate Explorer"]} />
      <PageHeader
        eyebrow="Screen"
        title="Candidate Explorer"
        lede="One medicine per row, one modelled bacterium per column. Four separate models, four separate statements — the row does not add up to a verdict."
      />

      {/* ------------------------------------------------------------- */}
      <Section title="Find a medicine" note="showing the medicines that reach highest in any one column">
        <form method="get" action={PATH} className="border border-rule bg-raised p-4 md:p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Medicine" hint="Generic name or brand.">
              <SearchField
                name="q"
                source="medicines"
                label="Medicine"
                defaultValue={search}
                placeholder="rifampin"
                submitOnSelect
              />
            </Field>
            <Field
              label="Reaches at least"
              hint={`A medicine is listed when any one of its four ${ACTIVITY_LABEL.toLowerCase()} values meets this.`}
            >
              <input
                type="number"
                name="min"
                min={0}
                max={1}
                step={0.05}
                defaultValue={minProbability ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Medicines shown">
              <select name="limit" defaultValue={String(limit)} className={inputClass}>
                {[20, 40, 80, 160].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-card border border-ink bg-ink px-4 font-display text-[13px] font-semibold text-paper"
            >
              Search
            </button>
            <Link
              href={PATH}
              className="inline-flex min-h-11 items-center rounded-card border border-rule-strong px-4 font-display text-[13px] text-ink no-underline"
            >
              Reset
            </Link>
            <Link
              href={withParams("/screening", {}, {})}
              className="inline-flex min-h-11 items-center text-[12px] text-link"
            >
              Screen one pathogen at a time instead →
            </Link>
          </div>
        </form>

        {chips.length > 0 ? (
          <div className="mt-4">
            <FilterChips chips={chips} path={PATH} params={params} />
          </div>
        ) : null}
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="Matrix" note={`${num(rows.length)} medicines · four independent models`}>
        {rows.length === 0 ? (
          <EmptyState title="No medicine matches">
            No medicine in the library satisfies this search. That is a statement about
            the search terms, not a finding about any medicine.
          </EmptyState>
        ) : (
          <TableWrap label="Medicine by pathogen matrix">
            <thead>
              <tr>
                <Th width="24%">Medicine</Th>
                {PATHOGEN_KEYS.map((key) => (
                  <MatrixSortHeader
                    key={key}
                    label={labelFor(key)}
                    pathogenKey={key}
                    active={sortPathogen === key}
                    path={PATH}
                    params={params}
                  />
                ))}
                <Th align="right" width="12%">
                  Registered studies
                </Th>
                <Th width="12%">Evidence so far</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const docked = row.cells.some((c) => c.bestDockingScore !== null);
                const predicted = row.cells.some((c) => c.probability !== null);
                // Deliberately not a per-pathogen verdict: this column says what
                // kind of evidence exists for the medicine at all. A trial for an
                // unrelated indication is not clinical evidence about a pathogen,
                // so the rung here is computational at most.
                const rung = predicted || docked ? "computational" : row.clinicalChecked ? "none" : "unchecked";
                return (
                  <Tr key={row.moleculeId}>
                    <Td>
                      <Link
                        href={`/medicines/${encodeURIComponent(row.moleculeId)}`}
                        transitionTypes={["nav-forward"]}
                        className="inline-block min-h-6 py-1 font-display text-[13px] font-semibold text-ink no-underline"
                      >
                        {row.genericName}
                      </Link>
                      {row.brandName ? (
                        <span className="mt-0.5 block text-[11px] text-muted">
                          {row.brandName}
                        </span>
                      ) : null}
                    </Td>

                    {row.cells.map((cell) => (
                      <Td key={cell.pathogenKey} align="right">
                        <ActivityCell
                          pathogenKey={cell.pathogenKey}
                          probability={cell.probability}
                          inTrainingData={cell.inTrainingData}
                          reason={`No prediction for ${labelFor(cell.pathogenKey)} from the ACTIVE model.`}
                        />
                        <ActivityBar
                          pathogenKey={cell.pathogenKey}
                          probability={cell.probability}
                        />
                        {cell.bestDockingScore !== null ? (
                          <span className="mt-1 block font-mono text-[10px] text-muted">
                            docked {cell.bestDockingScore.toFixed(2)}
                          </span>
                        ) : null}
                      </Td>
                    ))}

                    <Td align="right" mono>
                      {!row.clinicalChecked ? (
                        <span className="text-[11px] text-fainter">not yet checked</span>
                      ) : row.trialCount > 0 ? (
                        num(row.trialCount)
                      ) : (
                        <span className="text-[11px] text-fainter">no evidence found</span>
                      )}
                    </Td>

                    <Td>
                      <EvidenceIndicator value={rung} size="sm" />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="How to read a row">
        <div className="grid gap-4 lg:grid-cols-3">
          <LimitationCallout title="Four models, not one score">
            Each column comes from a model trained on that pathogen&rsquo;s own labelled
            data. The four values are not comparable to each other as measurements of the
            same thing, and nothing here combines them.
          </LimitationCallout>
          <LimitationCallout title="No candidate is ranked">
            Rows are alphabetical by default. Sorting by a column orders the table by
            that one model&rsquo;s output and says so in the header — there is no
            &ldquo;highest of the four&rdquo;, no overall score and no ordering by merit,
            because a value from the M.&nbsp;tuberculosis model and a value from the
            E.&nbsp;coli model are not measurements of the same thing.
          </LimitationCallout>
          <LimitationCallout title="The evidence column">
            This says what kind of record exists for the medicine, at most{" "}
            <em>computational</em>. A study registered for an unrelated indication is not
            clinical evidence about these bacteria, so it never lifts the rung here.
          </LimitationCallout>
        </div>
        <div className="mt-4">
          <LimitationCallout title="What the models represent">{RESISTANCE_LIMITATION}</LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}

/**
 * A column header that sorts by one model's output.
 *
 * Named after the pathogen whose model produced the column, because that is the
 * only honest thing a sort here can mean. Clicking it a second time returns to
 * alphabetical rather than reversing: an ascending sort of predicted activity
 * would put "lowest predicted activity" at the top of the page, which reads as
 * a ranking of the opposite kind.
 */
function MatrixSortHeader({
  label,
  pathogenKey,
  active,
  path,
  params,
}: {
  label: string;
  pathogenKey: PathogenKey;
  active: boolean;
  path: string;
  params: RawSearchParams;
}) {
  const href = withParams(path, params, { sortBy: active ? null : pathogenKey });

  return (
    <th
      scope="col"
      style={{ width: "13%" }}
      aria-sort={active ? "descending" : "none"}
      className="border-b border-rule-strong bg-sunken p-0 text-right"
    >
      <Link
        href={href}
        className={`flex min-h-11 items-center justify-end gap-1.5 px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] no-underline ${
          active ? "text-ink" : "text-muted"
        }`}
        title={
          active
            ? `Sorted by the ${label} model. Select again for alphabetical order.`
            : `Sort by the ${label} model's output`
        }
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? "▼" : "↕"}
        </span>
      </Link>
    </th>
  );
}
