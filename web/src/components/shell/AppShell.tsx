import type { ReactNode } from "react";
import type { BuildInfo } from "@/lib/queries/build";
import type { Readouts } from "@/lib/queries/nav";
import { AppFrame } from "./AppFrame";
import { Footer } from "./Footer";
import { Header } from "./Header";

/**
 * The page frame. Overview and Dashboard share it so that the editorial and
 * the operational surfaces read as one product at two densities, rather than
 * as two applications that happen to share a colour.
 *
 * The header carries identity and search only. Navigation inside the
 * application is the research index (`AppFrame`): a left rail on a wide
 * screen, a location bar on a phone.
 */
export function AppShell({
  children,
  build,
  readouts,
}: {
  children: ReactNode;
  build: BuildInfo;
  readouts: Readouts;
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
      <AppFrame footer={<Footer build={build} />} readouts={readouts}>
        {children}
      </AppFrame>
    </div>
  );
}
