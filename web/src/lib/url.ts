/**
 * Query-string helpers.
 *
 * Screening, the candidate matrix and the medicine directory keep their whole
 * state in the URL. That is deliberate: a filtered view is then a link someone
 * can paste into a report, and the server can render it without shipping a
 * client-side store. These helpers are the one place that knows how to carry
 * the existing parameters forward when a single one changes.
 */

/** The raw shape Next hands a page for `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export function firstValue(params: RawSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** A search parameter read as a number, or `undefined` when absent/unparseable. */
export function numberParam(params: RawSearchParams, key: string): number | undefined {
  const raw = firstValue(params, key);
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}


/**
 * Build `path?query` from the current parameters plus an override.
 *
 * `null` removes a parameter rather than writing an empty one, so a reset
 * produces a clean URL instead of `?search=&page=`.
 */
export function withParams(
  path: string,
  current: RawSearchParams,
  overrides: Record<string, string | number | null | undefined>,
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && single !== "") next.set(key, single);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }

  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}
