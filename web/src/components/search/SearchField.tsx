"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export interface Suggestion {
  /** What goes into the field when this suggestion is taken. */
  value: string;
  /** What the reader sees. Usually the same as `value`. */
  label: string;
  /** A short qualifier: a brand, a study count, "a model exists". */
  note?: string;
  /** Where to go when the suggestion is a destination rather than a filter. */
  href?: string;
  /** Marks a condition the system has a model for. */
  highlight?: boolean;
}

type Source = "medicines" | "conditions";

/**
 * The search field used across the site.
 *
 * Built rather than borrowed, for three reasons. The native `type="search"`
 * control brings a browser-drawn clear button and, on some platforms, a history
 * dropdown that competes with these suggestions — neither is themeable, and the
 * second offers the reader stale terms as though this site had returned them.
 * The suggestions here come only from what is in the database.
 *
 * It follows the ARIA combobox pattern: the input owns a listbox, the active
 * option is tracked with `aria-activedescendant`, and arrow keys, Enter,
 * Escape and Tab all behave the way a reader expects. An empty result says
 * "nothing in this database matches", which is a statement about coverage, not
 * about the medicine.
 */
export function SearchField({
  name,
  source,
  defaultValue = "",
  placeholder,
  label,
  navigate = false,
  submitOnSelect = false,
  className = "",
  inputClassName = "",
}: {
  name: string;
  source: Source;
  defaultValue?: string;
  placeholder?: string;
  /** Accessible name. Rendered by the caller when a visible label exists. */
  label: string;
  /** Take a suggestion as a destination (header) rather than a value (filters). */
  navigate?: boolean;
  /** Submit the surrounding form once a suggestion is taken. */
  submitOnSelect?: boolean;
  className?: string;
  /** Extra classes for the input itself, e.g. a taller hero field. */
  inputClassName?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const [term, setTerm] = useState(defaultValue);
  const [hits, setHits] = useState<Suggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) return;
    const controller = new AbortController();
    // Debounced: a query per keystroke would be a query per keystroke.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const endpoint = source === "medicines" ? "/api/search" : "/api/conditions";
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const raw = (await res.json()) as unknown;
        if (!Array.isArray(raw)) return;
        setHits(
          raw.map((row) => {
            const r = row as Record<string, unknown>;
            if (source === "medicines") {
              return {
                value: String(r.name ?? ""),
                label: String(r.name ?? ""),
                note: r.note == null ? undefined : String(r.note),
                href: r.href == null ? undefined : String(r.href),
              };
            }
            return {
              value: String(r.name ?? ""),
              label: String(r.name ?? ""),
              note: r.note == null ? undefined : String(r.note),
              highlight: r.modelled === true,
            };
          }),
        );
      } catch {
        // An aborted or failed lookup leaves the previous list in place rather
        // than replacing it with "no match", which would be a false negative.
      } finally {
        setLoading(false);
      }
    }, 170);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, source]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const panelOpen = open && term.trim().length >= 2;
  const list = hits ?? [];

  function take(hit: Suggestion) {
    if (navigate && hit.href) {
      setOpen(false);
      router.push(hit.href);
      return;
    }
    setTerm(hit.value);
    setOpen(false);
    setActive(-1);
    if (submitOnSelect) {
      // Let React commit the value before the form reads it.
      requestAnimationFrame(() => inputRef.current?.form?.requestSubmit());
    }
  }

  return (
    <div ref={boxRef} className={`relative ${className}`.trim()}>
      <div className="relative">
        <input
          ref={inputRef}
          /* Deliberately not type="search": the browser's own clear button and
             history dropdown are neither themeable nor ours to speak for. */
          type="text"
          name={name}
          value={term}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={panelOpen}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setTerm(next);
            setActive(-1);
            if (next.trim().length < 2) setHits(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setActive(-1);
              return;
            }
            if (!panelOpen || list.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => (i + 1) % list.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => (i <= 0 ? list.length - 1 : i - 1));
            } else if (event.key === "Enter" && active >= 0) {
              // Only intercept Enter when a suggestion is highlighted; otherwise
              // the form submits with whatever was typed, which is the point.
              event.preventDefault();
              take(list[active]);
            } else if (event.key === "Tab" && active >= 0) {
              take(list[active]);
            }
          }}
          className={`min-h-11 w-full rounded-card border border-rule-strong bg-pure py-2.5 pl-3 pr-9 font-mono text-[12px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(180,83,9,0.14)] ${inputClassName}`}
        />

        {term ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setTerm("");
              setHits(null);
              setActive(-1);
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 flex h-9 w-8 -translate-y-1/2 items-center justify-center font-mono text-[13px] text-muted"
          >
            ×
          </button>
        ) : null}
      </div>

      {panelOpen ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          aria-busy={loading}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 m-0 max-h-[300px] list-none overflow-y-auto rounded-card border border-rule bg-raised p-0 shadow-[0_8px_24px_-12px_rgba(18,19,15,0.25)]"
        >
          {hits === null ? (
            <li className="list-none px-3 py-2.5 font-mono text-[11px] text-muted">
              Searching…
            </li>
          ) : list.length === 0 ? (
            <li className="list-none px-3 py-2.5 text-[12px] leading-snug text-muted">
              Nothing in this dataset matches. That says what has been loaded here,
              not anything about the medicine or condition.
            </li>
          ) : (
            list.map((hit, index) => (
              <li key={`${hit.value}-${index}`} className="list-none">
                <button
                  type="button"
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => take(hit)}
                  className="flex min-h-11 w-full flex-col items-start justify-center gap-0.5 border-b border-rule-soft px-3 py-2 text-left"
                  style={{
                    background: index === active ? "var(--color-paper)" : "transparent",
                  }}
                >
                  <span className="font-display text-[13px] text-ink">{hit.label}</span>
                  {hit.note ? (
                    <span
                      className="font-mono text-[10px]"
                      style={{
                        color: hit.highlight
                          ? "var(--color-computational)"
                          : "var(--color-muted)",
                      }}
                    >
                      {hit.note}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
