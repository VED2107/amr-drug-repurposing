/**
 * The Smart Screening mark: "Second use".
 *
 * Half of a capsule meets a molecular ring: an existing medicine, read again as
 * a structure that might answer a new question. The capsule is the medicine
 * already approved; the ochre ring is the structure the screening looks at.
 * Drawn on a 256 grid so it holds at 16px as a favicon (`app/icon.svg` draws
 * the same shapes). Decorative beside the wordmark, which carries the name.
 */
export function Mark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
      className={`amr-mark-logo ${className}`}
    >
      <rect width="256" height="256" rx="20" fill="#12130F" />
      <g transform="translate(128 128) scale(0.92) translate(-128 -128)">
        <path className="amr-mark-capsule" d="M131.5 72V184H75.5A56 56 0 0 1 75.5 72Z" fill="#F6F4EF" />
        <path
          className="amr-mark-ring"
          fillRule="evenodd"
          fill="#B45309"
          d="M188 72L236.5 100L236.5 156L188 184L139.5 156L139.5 100ZM188 94L217.44 111L217.44 145L188 162L158.56 145L158.56 111Z"
        />
      </g>
    </svg>
  );
}
