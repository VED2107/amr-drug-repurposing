/**
 * The AMR Research mark.
 *
 * Four bars hang from one spine, the way the research index draws coverage:
 * three run the full width, one stops short in ochre. It is the site's own
 * finding in its simplest form: most of the library has been checked and
 * scored, and the evidence runs out somewhere. The shorter bar is the one
 * accent, as everywhere else.
 *
 * Geometry on a 32-unit grid so it holds at 16px as a favicon
 * (`app/icon.svg` draws the same shapes). Decorative beside the wordmark,
 * which carries the name.
 */
export function Mark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="32" height="32" rx="2" fill="#12130F" />
      <rect x="7" y="6" width="1.5" height="20" fill="#F6F4EF" />
      <rect x="8.5" y="7.5" width="16.5" height="3" fill="#F6F4EF" />
      <rect x="8.5" y="12.5" width="16.5" height="3" fill="#F6F4EF" />
      <rect x="8.5" y="17.5" width="12" height="3" fill="#F6F4EF" />
      <rect x="8.5" y="22.5" width="4" height="3" fill="#B45309" />
    </svg>
  );
}
