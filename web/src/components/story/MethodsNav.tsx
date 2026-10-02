"use client";

import { useEffect, useState } from "react";

const PARTS = [
  { id: "how-the-models-learned", n: "01", label: "How the models learned" },
  { id: "sources", n: "02", label: "What we used" },
  { id: "training", n: "03", label: "Training, step by step" },
  { id: "reading", n: "04", label: "How to read a result" },
];

/**
 * The method page's chapter rail: four parts, the one on screen marked, each a
 * link. It reads the page with an IntersectionObserver (no scroll listener).
 */
export function MethodsNav() {
  const [current, setCurrent] = useState(PARTS[0].id);
  useEffect(() => {
    const els = PARTS.map((p) => document.getElementById(p.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setCurrent(seen[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <nav aria-label="On this page" className="amr-rail">
      <p className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">On this page</p>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {PARTS.map((p) => (
          <li key={p.id}>
            <a
              href={`#${p.id}`}
              aria-current={current === p.id ? "true" : undefined}
              className="amr-rail-link flex items-baseline gap-2.5 rounded-full py-1.5 pl-3.5 pr-3 text-[13px] text-ink-2 no-underline"
            >
              <span className="font-mono text-[11px] text-accent">{p.n}</span>
              {p.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
