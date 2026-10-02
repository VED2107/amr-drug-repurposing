/**
 * The presentation's opening chain, small enough to sit under the headline:
 * an approved medicine, its molecular structure, a bacterial target. It draws
 * itself once on load (the stylesheet animates `amr-hc-draw` strokes); with
 * reduced motion it is simply drawn.
 */
export function HeroChain() {
  return (
    <ol aria-label="An approved medicine, its molecular structure, a bacterial target" className="amr-hc m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
      <Item label="an approved medicine" i={0}>
        <svg viewBox="0 0 44 22" width="44" height="22" aria-hidden="true">
          <path d="M22 2 h9 a9 9 0 0 1 0 18 H22 Z" fill="#f5e6d8" />
          <rect className="amr-hc-draw" pathLength={1} x="2" y="2" width="40" height="18" rx="9" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" />
          <path className="amr-hc-draw" pathLength={1} d="M22 2 V20" stroke="var(--color-ink)" strokeWidth="1.6" />
        </svg>
      </Item>
      <Arrow i={1} />
      <Item label="its molecular structure" i={2}>
        <svg viewBox="0 0 40 26" width="40" height="26" aria-hidden="true">
          <path className="amr-hc-draw" pathLength={1} d="M14 3 L23.5 8.5 V19.5 L14 25 L4.5 19.5 V8.5 Z" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinejoin="round" />
          <path className="amr-hc-draw" pathLength={1} d="M23.5 8.5 L31 4" stroke="var(--color-ink)" strokeWidth="1.6" />
          <circle className="amr-hc-dot" cx="33" cy="3.5" r="2.6" fill="var(--color-accent)" />
        </svg>
      </Item>
      <Arrow i={3} />
      <Item label="a bacterial target" i={4}>
        <svg viewBox="0 0 44 22" width="44" height="22" aria-hidden="true">
          <rect className="amr-hc-draw" pathLength={1} x="2" y="2" width="40" height="18" rx="9" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" />
          <path className="amr-hc-dot" d="M26 16 V10 a5 5 0 0 1 10 0 V16 H32.5 V12.5 H29.5 V16 Z" fill="#e4e2f6" stroke="var(--color-computational)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </Item>
    </ol>
  );
}

function Item({ label, i, children }: { label: string; i: number; children: React.ReactNode }) {
  return (
    <li className="amr-hc-item flex items-center gap-2" style={{ ["--i" as string]: i }}>
      {children}
      <span className="text-[14px] text-ink-2">{label}</span>
    </li>
  );
}

function Arrow({ i }: { i: number }) {
  return (
    <li aria-hidden="true" className="amr-hc-item" style={{ ["--i" as string]: i }}>
      <svg viewBox="0 0 22 10" width="22" height="10">
        <path d="M1 5 H20 M15.5 1 L20 5 L15.5 9" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </li>
  );
}
