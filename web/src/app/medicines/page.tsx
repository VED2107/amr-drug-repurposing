import Link from "next/link";

import { SearchField } from "@/components/search/SearchField";

import { Field, Pagination, TableWrap, Td, Th, Tr, inputClass } from "@/components/data";
import {
  Breadcrumb,
  EmptyState,
  LimitationCallout,
  Page,
  PageHeader,
  Section,
  num,
} from "@/components/primitives";
import { getMedicineDirectory } from "@/lib/queries/medicines";
import { firstValue, numberParam, type RawSearchParams } from "@/lib/url";

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

const PATH = "/medicines";

/**
 * Drug Details — the directory.
 *
 * The way into one medicine's evidence page. Counts in this table are counts of
 * records, not findings: "4 predictions" means four models produced a number,
 * and "6 studies" means six registrations were retrieved.
 */
export default async function MedicinesPage(props: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await props.searchParams;
  const search = firstValue(params, "q")?.trim() ?? "";
  const page = Math.max(1, numberParam(params, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(10, numberParam(params, "size") ?? 50));

  const result = await getMedicineDirectory({ search: search || undefined, page, pageSize });

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Explore", "Drug Details"]} />
      <PageHeader
        eyebrow="Explore"
        title="Drug Details"
        lede="Every approved medicine in the library that resolved to a molecular structure. Open one to see its activity, chemistry, docking, registered studies and provenance in that order."
      />

      <Section title="Find a medicine" note={`${num(result.total)} in the library`}>
        <form method="get" action={PATH} className="border border-rule bg-raised p-4 md:p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Search" hint="Generic name, brand, ChEMBL ID or InChIKey.">
              <SearchField
                name="q"
                source="medicines"
                label="Search medicines"
                defaultValue={search}
                placeholder="ciprofloxacin"
                submitOnSelect
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
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-card border border-ink bg-ink px-4 font-display text-[13px] font-semibold text-paper"
              >
                Search
              </button>
            </div>
          </div>
        </form>
      </Section>

      <Section title="Medicines" note="alphabetical">
        {result.rows.length === 0 ? (
          <EmptyState title="No medicine matches that search">
            Nothing in the approved library matches. The library holds medicines that
            resolved to a structure; a product that never resolved has no row here.
          </EmptyState>
        ) : (
          <>
            <TableWrap label="Medicine directory">
              <thead>
                <tr>
                  <Th width="30%">Medicine</Th>
                  <Th width="16%">Identifier</Th>
                  <Th align="right" width="13%">
                    Predictions
                  </Th>
                  <Th align="right" width="13%">
                    Docking poses
                  </Th>
                  <Th align="right" width="16%">
                    Registered studies
                  </Th>
                  <Th align="right" width="12%">
                    Approved products
                  </Th>
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
                          {row.brandCount > 1 ? ` + ${row.brandCount - 1} more` : ""}
                        </span>
                      ) : null}
                    </Td>
                    <Td mono className="text-[11px] text-muted">
                      {row.chemblId ?? row.moleculeId}
                    </Td>
                    <Td align="right" mono>
                      {row.predictionCount > 0 ? (
                        num(row.predictionCount)
                      ) : (
                        <span className="text-[11px] text-fainter">none</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {row.dockedPoses > 0 ? (
                        num(row.dockedPoses)
                      ) : (
                        <span className="text-[11px] text-fainter">not yet docked</span>
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
                    <Td align="right" mono>
                      {num(row.brandCount)}
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

      <Section title="What the counts mean">
        <LimitationCallout title="Records, not findings">
          A prediction is a model output, a pose is a geometry, and a registered study is
          a registration. None of the three establishes that a medicine treats an
          infection, and the columns are counted separately here so they cannot be read
          as one accumulating body of proof.
        </LimitationCallout>
      </Section>
    </Page>
  );
}
