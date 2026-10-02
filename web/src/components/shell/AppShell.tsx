import type { ReactNode } from "react";

import { ButtonPointer } from "./ButtonPointer";
import { Footer } from "./Footer";
import { Header } from "./Header";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a
        href="#main"
        className="absolute left-[-9999px] top-0 z-[99] bg-ink px-[18px] py-3 font-mono text-[12px] text-white focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
      <ButtonPointer />
    </div>
  );
}
