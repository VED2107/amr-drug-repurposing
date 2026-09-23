import Link from "next/link";

import { SearchField } from "@/components/search/SearchField";

import {
  CheckboxField,
  Field,
  FilterChips,
  Pagination,
  SortHeader,
  TabStrip,
  TableWrap,
  Td,
  Th,
  Tr,
  inputClass,
} from "@/components/data";
import { ActivityCell } from "@/components/evidence/ActivityCell";
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
import { getScreeningPage } from "@/lib/queries/screening";
import {
  ACTIVITY_LABEL,
  DOCKING_SCREENING_TARGET_KCAL_MOL,
  RESISTANCE_LIMITATION,
} from "@/lib/science";
import { flagParam, firstValue, numberParam, withParams, type RawSearchParams } from "@/lib/url";
import { isPathogenKey, type PathogenKey } from "@/lib/types";

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

const PATH = "/screening";

/**
 * Drug Screening.
 *
 * The whole scored library, one pathogen at a time. Three things this page is
 * careful about:
 *
 * 1. A probability belongs to one pathogen, so the pathogen is a tab rather
 *    than a column — there is no row that shows "the" probability of a medicine.
 * 2. Rows are ordered, and an ordering is not a ranking. The page says so, and
 *    a medicine with no prediction sorts last rather than sorting as zero.
 * 3. Registered studies are counted for the medicine across every indication.
 *    That is a different statement from "studies of this medicine against this
 *    organism", and the column is labelled accordingly.
 */
export default async function ScreeningPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;

  const pathogenParam = firstValue(params, "pathogen");
  const pathogen: PathogenKey = isPathogenKey(pathogenParam) ? pathogenParam : "mrsa";

  const search = firstValue(params, "q")?.trim() ?? "";
  const minProbability = numberParam(params, "min");
  const maxProbability = numberParam(params, "max");
  const hasDocking = flagParam(params, "dock");
  const hasTrials = flagParam(params, "trials");
  const hasMeasurements = flagParam(params, "meas");
  const excludeTrainingData = flagParam(params, "unseen");
  const sort = firstValue(params, "sort") === "name" ? "name" : "probability";
  const direction = firstValue(params, "dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, numberParam(params, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(10, numberParam(params, "size") ?? 25));

  const [pathogens, result] = await Promise.all([
    getPathogens(),
    getScreeningPage({
      pathogen,
      search: search || undefined,
      minProbability,
      maxProbability,
      hasDocking,
      hasTrials,
      hasMeasurements,
      excludeTrainingData,
      sort,
      direction,
      page,
      pageSize,
    }),
  ]);

  const current = pathogens.find((p) => p.key === pathogen) ?? null;
  const modelVersion = current?.activeModelVersion ?? null;

  const chips: { label: string; clear: Record<string, null> }[] = [];
  if (search) chips.push({ label: `name contains “${search}”`, clear: { q: null } });
  if (minProbability !== undefined)
    chips.push({ label: `probability ≥ ${minProbability}`, clear: { min: null } });
  if (maxProbability !== undefined)
    chips.push({ label: `probability ≤ ${maxProbability}`, clear: { max: null } });
  if (hasDocking) chips.push({ label: "has a docking pose", clear: { dock: null } });
  if (hasTrials) chips.push({ label: "has registered studies", clear: { trials: null } });
  if (hasMeasurements)
    chips.push({ label: "has lab measurements", clear: { meas: null } });
  if (excludeTrainingData)
    chips.push({ label: "not in training data", clear: { unseen: null } });

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Screen", "Drug Screening"]} />
      <PageHeader
        eyebrow="Screen"
        title="Drug Screening"
        lede="Every approved medicine that has a structure, scored by the ACTIVE model for one pathogen at a time, with the evidence that exists alongside each score."
        aside={
          <dl className="m-0 text-right">
            <dt className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-fainter">
              ACTIVE model
            </dt>
            <dd className="m-0 font-mono text-[12px] text-ink">{modelVersion ?? "unavailable"}</dd>
          </dl>
        }
      />

      {/* ------------------------------------------------------------- */}
      <Section
        title="Pathogen"
        note="one trained model each — nothing outside these four shows a probability"
      >
        <TabStrip
          label="Choose a pathogen"
          param="pathogen"
          path={PATH}
          params={params}
          current={pathogen}
          options={pathogens.map((p) => ({
            value: p.key,
            label: p.label,
            note: p.activeModelVersion ?? "no ACTIVE model",
          }))}
        />
        {current ? (
          <p className="m-0 mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
            {current.fullName} — {num(current.labelledRecords)} labelled bioactivity records,{" "}
            {num(current.resistantStrainRecords)} of them against a named resistant strain.
          </p>
        ) : null}
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="Filters" note="the whole view lives in the URL">
        <form method="get" action={PATH} className="border border-rule bg-raised p-4 md:p-5">
          {/* Sorting and the pathogen survive a filter submission. */}
          <input type="hidden" name="pathogen" value={pathogen} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={direction} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Medicine" hint="Generic name, brand, ChEMBL ID or InChIKey.">
              <SearchField
                name="q"
                source="medicines"
                label="Medicine"
                defaultValue={search}
                placeholder="levoketoconazole"
                submitOnSelect
              />
            </Field>
            <Field
              label={`Minimum ${ACTIVITY_LABEL}`}
              hint="A fraction between 0 and 1. Leave blank for no lower bound."
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
            <Field label={`Maximum ${ACTIVITY_LABEL}`} hint="Leave blank for no upper bound.">
              <input
                type="number"
                name="max"
                min={0}
                max={1}
                step={0.05}
                defaultValue={maxProbability ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Rows per page">
              <select name="size" defaultValue={String(pageSize)} className={inputClass}>
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className="mt-4 border-0 p-0">
            <legend className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              Only show medicines that have
            </legend>
            <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
              <CheckboxField name="dock" label="A stored docking pose" defaultChecked={hasDocking} />
              <CheckboxField
                name="trials"
                label="Registered studies (any indication)"
                defaultChecked={hasTrials}
              />
              <CheckboxField
                name="meas"
                label="Lab measurements against this pathogen"
                defaultChecked={hasMeasurements}
              />
              <CheckboxField
                name="unseen"
                label="No place in this model's training data"
                defaultChecked={excludeTrainingData}
              />
            </div>
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
            <button
              type="submit"
              className="amr-btn"
            >
              Apply filters
            </button>
            <Link
              href={withParams(PATH, {}, { pathogen })}
              className="inline-flex min-h-11 items-center rounded-card border border-rule-strong px-4 font-display text-[13px] text-ink no-underline"
            >
              Reset
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
      <Section
        title="Results"
        note={`${num(result.total)} medicines match · ordering is not a ranking`}
      >
        {result.rows.length === 0 ? (
          <EmptyState title="No medicine matches these filters">
            Nothing in the library satisfies every condition above. That is a statement
            about the filters, not a finding about the medicines — widen the range or
            clear a filter to see what is there.
          </EmptyState>
        ) : (
          <>
            <TableWrap label="Screening results">
              <thead>
                <tr>
                  <SortHeader
                    label="Medicine"
                    sortKey="name"
                    currentSort={sort}
                    currentDirection={direction}
                    path={PATH}
                    params={params}
                    width="26%"
                  />
                  <SortHeader
                    label={ACTIVITY_LABEL}
                    sortKey="probability"
                    currentSort={sort}
                    currentDirection={direction}
                    path={PATH}
                    params={params}
                    align="right"
                    width="16%"
                  />
                  <Th align="right" width="15%">
                    Best docking pose
                  </Th>
                  <Th align="right" width="15%">
                    Lab measurements
                  </Th>
                  <Th align="right" width="16%">
                    Registered studies
                  </Th>
                  <Th width="12%">Identifier</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
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
                    <Td align="right">
                      <ActivityCell
                        pathogenKey={row.pathogenKey}
                        probability={row.probability}
                        inTrainingData={row.inTrainingData}
                        reason="No prediction from the ACTIVE model for this medicine."
                      />
                    </Td>
                    <Td align="right" mono>
                      {row.bestDockingScore === null ? (
                        <span className="text-[11px] text-fainter">not yet docked</span>
                      ) : (
                        <>
                          {row.bestDockingScore.toFixed(3)}
                          <span className="ml-1 text-[10px] text-muted">kcal/mol</span>
                        </>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {row.measuredRecords > 0 ? (
                        num(row.measuredRecords)
                      ) : (
                        <span className="text-[11px] text-fainter">none recorded</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {!row.clinicalChecked ? (
                        <span className="text-[11px] text-fainter">not yet checked</span>
                      ) : row.trialCount > 0 ? (
                        num(row.trialCount)
                      ) : (
                        <span className="text-[11px] text-fainter">no evidence found</span>
                      )}
                    </Td>
                    <Td mono className="text-[11px] text-muted">
                      {row.chemblId ?? row.moleculeId}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>

            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              path={PATH}
              params={params}
              unit="medicines"
            />
          </>
        )}
      </Section>

      {/* ------------------------------------------------------------- */}
      <Section title="What this table does not say">
        <div className="grid gap-4 lg:grid-cols-3">
          <LimitationCallout title="The order">
            Sorting by {ACTIVITY_LABEL.toLowerCase()} arranges rows; it does not rank
            medicines by merit. A medicine with no prediction sorts last in both
            directions because a missing value is not a low value.
          </LimitationCallout>
          <LimitationCallout title="The docking column">
            A pose score is a geometric estimate from AutoDock Vina. This project screens
            at {DOCKING_SCREENING_TARGET_KCAL_MOL.toFixed(1)} kcal/mol, which is this
            project&rsquo;s target and not a universal binding cutoff. A score is not
            proof of binding.
          </LimitationCallout>
          <LimitationCallout title="The studies column">
            Registered studies are counted for the medicine across every indication, not
            for this pathogen. A registered trial is not a successful trial, and approval
            for one use is not approval for another.
          </LimitationCallout>
        </div>
        <div className="mt-4">
          <LimitationCallout title="What the model was trained on">
            {RESISTANCE_LIMITATION} Medicines marked <em>trained</em> were part of this
            model&rsquo;s training data, so their score is recall rather than an unseen
            prediction.
          </LimitationCallout>
        </div>
      </Section>
    </Page>
  );
}
