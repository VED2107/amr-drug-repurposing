"use client";

import { ViewTransition, useEffect, useState } from "react";
import type { ReactNode, ViewTransitionInstance } from "react";

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
 *
 * That covers a navigation that *starts* in a hidden tab. It cannot cover one
 * that starts visible and loses visibility partway through; the browser then
 * aborts the running transition. React already treats that abort as benign,
 * but it matches the exact message "Transition was aborted because of invalid
 * state", and Chrome now appends ". Document hidden". The unmatched message
 * reaches React's recoverable-error path and the dev overlay.
 * `quietHiddenAborts` rewrites only that one rejection to the wording React
 * recognises. Every other error passes through untouched.
 */

const REACT_BENIGN_MESSAGE = "Transition was aborted because of invalid state";

function normaliseHiddenAbort(error: unknown): never {
  if (
    error instanceof DOMException &&
    error.name === "InvalidStateError" &&
    error.message.startsWith(REACT_BENIGN_MESSAGE) &&
    error.message !== REACT_BENIGN_MESSAGE
  ) {
    throw new DOMException(REACT_BENIGN_MESSAGE, "InvalidStateError");
  }
  throw error;
}

let installed = false;

function quietHiddenAborts() {
  if (installed || typeof document === "undefined") return;
  const native = document.startViewTransition;
  if (typeof native !== "function") return;
  installed = true;

  document.startViewTransition = function (this: Document, ...args: Parameters<typeof native>) {
    const transition = native.apply(this, args);
    const wrapped = new Map<PropertyKey, Promise<unknown>>();
    return new Proxy(transition, {
      get(target, prop) {
        if (prop === "ready" || prop === "finished" || prop === "updateCallbackDone") {
          // One derived promise per property, so repeated reads share it.
          if (!wrapped.has(prop)) {
            wrapped.set(prop, (target[prop] as Promise<unknown>).catch(normaliseHiddenAbort));
          }
          return wrapped.get(prop);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as typeof native;
}

quietHiddenAborts();

const DIRECTIONAL = {
  "nav-forward": "amr-forward",
  "nav-back": "amr-back",
  default: "amr-cross",
} as const;

/*
  The waterline, driven from script.

  An entering page is captured whole, so its transition layer is as tall as the
  page (thousands of pixels), not as tall as the screen. A mask positioned in
  CSS can only be placed relative to that layer, which would spend most of the
  rise below the fold. Here the layer's on-screen offset and height are read
  when the transition starts, and the surface is moved from just below the
  bottom of the viewport to just above its top, whatever the scroll position.

  Three mask layers, set in globals.css: the wave strip, the translucent wash
  just ahead of it, and a solid body filling everything beneath the strip.
  Only their positions animate. Without this script the CSS still settles the
  page in with a short refraction blur, so nothing depends on it.
*/

const STRIP = 320; // px: height of the wave image; the surface sits at its middle
const DURATION = 720;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function offsetTop(transform: string): number {
  // matrix(a, b, c, d, tx, ty) or matrix3d(..., tx, ty, tz, 1)
  const values = transform.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (transform.startsWith("matrix3d") && values.length >= 16) return values[13];
  if (transform.startsWith("matrix") && values.length >= 6) return values[5];
  return 0;
}

function riseWaterline(instance: ViewTransitionInstance, types: string[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const vh = window.innerHeight;
  const top = offsetTop(instance.group.getComputedStyle().transform);
  const height = parseFloat(instance.new.getComputedStyle().height) || vh;

  // Surface position in the layer's own coordinates: the viewport's top edge
  // is at -top, its bottom edge at vh - top.
  const from = vh - top + 28;
  const to = -top - 36;
  const back = types.includes("nav-back");
  const crest = back ? 600 : -600;
  const wash: [number, number] = back ? [-300, -700] : [300, 700];

  const frame = (surface: number, crestX: number, washX: number) => ({
    maskPosition:
      `${crestX}px ${surface - STRIP / 2}px, ` +
      `${washX}px ${surface - STRIP / 2}px, ` +
      `0px ${surface + STRIP / 2 - 2}px`,
    maskSize: `1200px ${STRIP}px, 1200px ${STRIP}px, 100% ${Math.ceil(height + vh)}px`,
  });

  const animation = instance.new.animate(
    [frame(from, 0, wash[0]), frame(to, crest, wash[1])],
    { duration: DURATION, easing: EASE, fill: "both" },
  );
  return () => animation.cancel();
}

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
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none" onEnter={riseWaterline}>
      {children}
    </ViewTransition>
  );
}
