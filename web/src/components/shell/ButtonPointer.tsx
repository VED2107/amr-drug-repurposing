"use client";

import { useEffect } from "react";

/**
 * Tells every button where the pointer came in and where it left, so the
 * hover fill can grow from that point and drain back toward the exit.
 *
 * One delegated listener for the whole document, writing two custom
 * properties on the button itself (never on an ancestor, which would restyle
 * every descendant). With no script the stylesheet's defaults apply and the
 * fill simply wipes in from the left, as it always did.
 */
export function ButtonPointer() {
  useEffect(() => {
    const set = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".amr-btn, .amr-btn-quiet");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    };
    // Primary buttons lean toward the pointer, at most 3px, and spring back
    // when it leaves. Skipped when the reader prefers less motion.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const lean = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || still.matches) return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".amr-btn");
      if (!el) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 6;
        const dy = ((e.clientY - (r.top + r.height / 2)) / r.height) * 4;
        el.style.translate = `${dx.toFixed(2)}px ${dy.toFixed(2)}px`;
      });
    };
    const release = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".amr-btn");
      if (el && !el.contains(e.relatedTarget as Node | null)) {
        cancelAnimationFrame(frame);
        el.style.translate = "";
      }
    };
    document.addEventListener("pointerover", set, { passive: true });
    document.addEventListener("pointerout", set, { passive: true });
    document.addEventListener("pointermove", lean, { passive: true });
    document.addEventListener("pointerout", release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerover", set);
      document.removeEventListener("pointerout", set);
      document.removeEventListener("pointermove", lean);
      document.removeEventListener("pointerout", release);
    };
  }, []);
  return null;
}
