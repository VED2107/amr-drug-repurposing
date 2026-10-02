"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Marks a block as "in view" the first time it scrolls onto the screen, so the
 * stylesheet can play its one entrance (a figure drawing itself, a funnel
 * narrowing, the pipeline advancing stage by stage).
 *
 * The content is fully visible in the server HTML. Only once this runs, and
 * only when the reader allows motion, does the stylesheet hold an off-screen
 * block back until it arrives; a block already on screen is marked before the
 * hold applies, so nothing visible ever blinks out.
 */
export function Reveal({
  children,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "ol" | "ul";
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.dataset.in = "";
      el.dataset.armed = "";
      return;
    }
    el.dataset.armed = "";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.in = "";
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} id={id} data-reveal="" className={className}>
      {children}
    </Tag>
  );
}
