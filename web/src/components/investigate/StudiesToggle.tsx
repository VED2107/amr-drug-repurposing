"use client";

import { useState } from "react";

/**
 * Hides or shows the registered-studies block (`target`), from the filter row.
 * The block is visible in the server HTML; hiding only happens on request.
 */
export function StudiesToggle({ target, total }: { target: string; total: number }) {
  const [hidden, setHidden] = useState(false);
  return (
    <button
      type="button"
      aria-controls={target}
      aria-expanded={!hidden}
      onClick={() => {
        const next = !hidden;
        setHidden(next);
        document.getElementById(target)?.toggleAttribute("hidden", next);
      }}
      className="amr-btn-quiet"
    >
      <span aria-hidden="true" className="amr-toggle-chevron" data-open={!hidden ? "" : undefined} />
      {hidden ? `Show ${total.toLocaleString("en-GB")} ${total === 1 ? "study" : "studies"}` : "Hide studies"}
    </button>
  );
}
