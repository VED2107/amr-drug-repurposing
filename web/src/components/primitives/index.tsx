import type { ReactNode } from "react";

import { PageTransition } from "@/components/motion";

/**
 * The page body.
 *
 * Wrapped in `PageTransition` here rather than in the layout: a layout persists
 * across navigation, so its enter and exit would never fire.
 */
export function Page({ children }: { children: ReactNode }) {
  return (
    <PageTransition>
      <div className="mx-auto max-w-shell px-4 py-8 md:px-8 md:py-12 lg:px-12">{children}</div>
    </PageTransition>
  );
}
