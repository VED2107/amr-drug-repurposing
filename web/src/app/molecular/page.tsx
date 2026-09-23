import Link from "next/link";

import { DistributionBars, TableWrap, Td, Th, Tr } from "@/components/data";
import {
  Breadcrumb,
  KPI,
  LimitationCallout,
  MetricGrid,
  Page,
  PageHeader,
  Section,
  num,
  orDash,
} from "@/components/primitives";
import {
  getDescriptorHistogram,
  getMolecularOverview,
  getTopScaffolds,
  getValidationFailures,
} from "@/lib/queries/analysis";

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

/**
 * Molecular Analysis.
 *
 * What the chemistry stage produced, library-wide. The distributions are counts
 * of stored descriptors over stated bucket edges — not fitted curves — and the
 * rejected structures are listed with the reason the standardiser gave, because
 * a library that silently drops what it could not parse reports a cleaner
 * dataset than it has.
 */
export default async function MolecularPage() {
  const [overview, mw, logp, tpsa, qed, scaffolds, failures] = await Promise.all([
    getMolecularOverview(),
    getDescriptorHistogram("mw", [200, 300, 400, 500, 600, 800]),
    getDescriptorHistogram("logp", [-2, 0, 2, 4, 6]),
    getDescriptorHistogram("tpsa", [40, 80, 120, 160, 200]),
    getDescriptorHistogram("qed", [0.2, 0.4, 0.6, 0.8]),
    getTopScaffolds(12),
    getValidationFailures(15),
  ]);

  return (
    <Page>
      <Breadcrumb trail={["Dashboard", "Evidence", "Molecular"]} />
      <PageHeader
        eyebrow="Evidence"
        title="Molecular Analysis"
        lede="The structures the models actually saw: how many resolved, what the standardiser rejected, and how the library's descriptors are distributed."
      />

      <Section title="Structures" note="counted at render time">
        <MetricGrid>
          <KPI
            value={num(overview.molecules)}
            label="Molecules in the library"
          />
          <KPI
            value={num(overview.valid)}
            label="Passed structure validation"
          />
          <KPI
            value={num(overview.invalid)}
            label="Rejected by the standardiser"
          />
          <KPI
            value={num(overview.withDescriptors)}
            label="Carry computed descriptors"
          />
          <KPI
            value={num(overview.distinctScaffolds)}
            label="Distinct Murcko scaffolds"
          />
          <KPI
            value={overview.featureVersions.join(", ") || "—"}
            label="Feature versions present"
          />
        </MetricGrid>
      </Section>

      <Section title="Descriptor distributions" note="fixed bucket edges, stated in each row">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Molecular weight (g/mol)
            </h3>
            <DistributionBars rows={mw} unit="molecular weight" />
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Calculated logP
            </h3>
            <DistributionBars rows={logp} unit="logP" />
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              Topological polar surface area (Å²)
            </h3>
            <DistributionBars rows={tpsa} unit="TPSA" />
          </div>
          <div>
            <h3 className="m-0 mb-3 font-display text-[15px] font-semibold text-ink">
              QED — quantitative estimate of drug-likeness
            </h3>
            <DistributionBars rows={qed} unit="QED" />
          </div>
        </div>

        <div className="mt-6">
          <LimitationCallout title="What a descriptor is">
            These are computed properties of a structure, not measurements. They describe
            the molecule as drawn; they say nothing about what it does in an organism, and
            a molecule outside a typical range is not thereby a worse candidate.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Lipinski violations" note="a rule of thumb about oral absorption">
        <DistributionBars
          rows={[
            { label: "0 violations", count: overview.lipinskiPass },
            { label: "1 violation", count: overview.lipinskiOne },
            { label: "2 or more", count: overview.lipinskiMultiple },
          ]}
          unit="Lipinski violations"
        />
        <div className="mt-4">
          <LimitationCallout title="Not a filter this system applies">
            Every medicine in this library is already approved for human use, so a
            violation here describes chemistry rather than viability. Nothing is excluded
            from screening on this basis.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Most common scaffolds" note="stereochemistry deliberately removed">
        <TableWrap label="Most common Murcko scaffolds">
          <thead>
            <tr>
              <Th width="76%">Murcko scaffold (SMILES)</Th>
              <Th align="right" width="24%">
                Molecules
              </Th>
            </tr>
          </thead>
          <tbody>
            {scaffolds.map((row) => (
              <Tr key={row.scaffold}>
                <Td mono className="break-all text-[11px]">
                  {row.scaffold}
                </Td>
                <Td align="right" mono>
                  {num(row.molecules)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-4">
          <LimitationCallout title="Why scaffolds matter here">
            The training and test splits are made by scaffold, and the scaffold is written
            without stereochemistry so that two enantiomers cannot land on opposite sides
            of a split and make a model look better than it is. That means a molecule can
            be absent from the training data while its chemistry is not —{" "}
            <Link href="/case-study">the case study</Link> is exactly that situation.
          </LimitationCallout>
        </div>
      </Section>

      <Section title="Rejected structures" note={`${num(overview.invalid)} in total`}>
        {failures.length === 0 ? (
          <LimitationCallout title="Nothing was rejected">
            Every structure in the library passed validation in this snapshot.
          </LimitationCallout>
        ) : (
          <>
            <TableWrap label="Structures rejected by the standardiser">
              <thead>
                <tr>
                  <Th width="26%">Molecule</Th>
                  <Th width="24%">Name</Th>
                  <Th width="50%">Reason given</Th>
                </tr>
              </thead>
              <tbody>
                {failures.map((row) => (
                  <Tr key={row.moleculeId}>
                    <Td mono className="break-all text-[11px]">
                      {row.moleculeId}
                    </Td>
                    <Td>{orDash(row.prefName)}</Td>
                    <Td mono className="text-[11px]">
                      {orDash(row.error)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="m-0 mt-3 font-mono text-[11px] text-muted">
              Showing {num(failures.length)} of {num(overview.invalid)}.
            </p>
          </>
        )}
      </Section>
    </Page>
  );
}
