import type { ReactNode } from "react";

export { PageTransition } from "./PageTransition";

/**
 * The motion vocabulary, in one place.
 *
 * Two rules decide everything here.
 *
 * First, frequency. A surface someone opens a hundred times a day should not
 * animate; a surface someone reads once should. So navigation carries a short
 * directional transition, narrative sections carry scroll-driven depth, and the
 * tables — the part of this site that gets used rather than read — carry
 * neither. Nothing moves underneath a number a reader is trying to compare.
 *
 * Second, purpose. The direction of a page transition says whether you went
 * deeper or came back. The parallax layers say which parts of a narrative
 * section are ground and which are figure. Neither is decoration, and when the
 * reader asks for reduced motion both disappear without taking any information
 * with them.
 */

/* ------------------------------------------------------------------ */
/* Scroll-driven depth                                                 */
/* ------------------------------------------------------------------ */

/**
 * A block that arrives as it enters the viewport.
 *
 * Implemented on a view timeline, so the animation is tied to scroll position
 * rather than to a timer: scroll back up and it plays backwards, stop halfway
 * and it stops halfway. There is no observer, no state and no main-thread work.
 */
export function Reveal({
  children,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  as?: "div" | "section" | "article" | "header" | "li";
  className?: string;
}) {
  return <Tag className={`amr-rise ${className}`.trim()}>{children}</Tag>;
}

/**
 * A layer that moves against the scroll while it is on screen.
 *
 * `depth` is how far it travels, in pixels, from below its resting position to
 * above it. Keep it small: the point is that the page has layers, not that the
 * layers are noticeable. A foreground element and a background element given
 * opposite depths read as two planes.
 */
export function Parallax({
  children,
  depth = 28,
  className = "",
}: {
  children: ReactNode;
  /** Positive drifts up as you scroll down; negative drifts down. */
  depth?: number;
  className?: string;
}) {
  return (
    <div
      className={`amr-parallax ${className}`.trim()}
      style={
        {
          "--amr-drift-from": `${depth}px`,
          "--amr-drift-to": `${-depth}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * A rule that draws itself left to right as its section arrives.
 * Used to mark the start of a section on the narrative surfaces only.
 */
export function DrawnRule({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`amr-draw block h-px w-full bg-rule-strong ${className}`.trim()}
    />
  );
}

/**
 * A group whose children arrive one after another.
 *
 * The cascade comes from each child's position in the scroll timeline rather
 * than from a delay, so a child that is already on screen when the page loads
 * does not sit invisible waiting for its turn.
 */
export function RevealGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`amr-stagger ${className}`.trim()}>{children}</div>;
}
