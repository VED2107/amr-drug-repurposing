import Link from "next/link";
import { APP_NAV } from "@/lib/nav";

/**
 * Footer. Carries the build provenance — which dataset, which feature version,
 * which database snapshot — because a figure without its build is not
 * reproducible, and this system's whole claim is that its figures are.
 */
export function Footer({
  build,
}: {
  build: { datasetVersion: string | null; featureVersion: string | null; snapshot: string | null };
}) {
  return (
    <footer className="border-t border-rule bg-raised">
      <div className="mx-auto grid max-w-shell gap-10 px-4 py-12 md:grid-cols-[2fr_1fr_1fr] md:px-8 lg:px-12">
        <div>
          <p className="m-0 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
            AMR Research
          </p>
          <p className="m-0 mt-2 max-w-[60ch] text-[13px] leading-relaxed text-ink-2">
            A screening framework that ranks already-approved medicines for predicted
            antibacterial activity against four drug-resistant bacteria, then shows what
            evidence exists for each one. It does not establish that any medicine treats
            any disease.
          </p>
        </div>

        <nav aria-label="Sections">
          <p className="m-0 mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Sections
          </p>
          <ul className="m-0 list-none p-0">
            {APP_NAV.flatMap((g) => g.items)
              .slice(0, 7)
              .map((item) => (
                <li key={item.href} className="mb-1.5">
                  <Link href={item.href} className="text-[13px] no-underline hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>

        <div>
          <p className="m-0 mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Build
          </p>
          <p className="m-0 font-mono text-[12px] leading-[1.8] text-ink-2">
            dataset {build.datasetVersion ?? "unavailable"}
            <br />
            features {build.featureVersion ?? "unavailable"}
            <br />
            database snapshot {build.snapshot ?? "unavailable"}
          </p>
        </div>
      </div>
    </footer>
  );
}
