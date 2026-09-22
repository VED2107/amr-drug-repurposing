"use client";

import { ViewTransition, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * The page transition, and the one condition under which it steps aside.
 *
 * A view transition captures the old page, holds a frozen frame, and animates
 * to the new one. A hidden document cannot paint, so the browser rejects the
 * attempt outright:
 *
 *     InvalidStateError: Transition was aborted because of invalid state.
 *                        Document hidden
 *
 * That happens whenever a navigation completes in a backgrounded tab — a link
 * opened into the background, a router navigation that lands while the reader
 * has switched away, a restored session. React recovers and the page is
 * correct, but the error is real and there is no reason to provoke it: when the
 * document is hidden there is, by definition, no animation for anyone to see.
 *
 * So the wrapper watches visibility and renders its children unwrapped while
 * the tab is hidden, restoring the transition when the reader comes back.
 * Nothing about the content changes either way.
 */

const DIRECTIONAL = {
  "nav-forward": "amr-forward",
  "nav-back": "amr-back",
  default: "amr-cross",
} as const;

export function PageTransition({ children }: { children: ReactNode }) {
  // Starts enabled so the server-rendered markup and the first client render
  // agree; a hidden tab corrects it on mount, before any navigation can occur.
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const sync = () => setAnimate(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  if (!animate) return <>{children}</>;

  return (
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      {children}
    </ViewTransition>
  );
}
