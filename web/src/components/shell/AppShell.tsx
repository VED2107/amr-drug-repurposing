import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { MobileNav } from "./MobileNav";

/**
 * The page frame. Overview and Dashboard share it so that the editorial and
 * the operational surfaces read as one product at two densities, rather than
 * as two applications that happen to share a colour.
 */
export function AppShell({
  children,
  build,
}: {
  children: ReactNode;
  build: { datasetVersion: string | null; featureVersion: string | null; snapshot: string | null };
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a
        href="#main"
        className="absolute left-[-9999px] top-0 z-[99] bg-ink px-[18px] py-3 font-mono text-[12px] text-white focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <Header snapshot={build.snapshot} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer build={build} />
      {/* Phone-only bottom navigation. The padding below keeps the last of the
          footer clear of the bar rather than letting it sit underneath. */}
      <div aria-hidden="true" className="h-[calc(3.25rem+env(safe-area-inset-bottom,0px))] md:hidden" />
      <MobileNav />
    </div>
  );
}
