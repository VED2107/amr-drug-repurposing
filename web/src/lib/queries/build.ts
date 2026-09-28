import "server-only";

import { dataVersion } from "@/lib/db/client";

export interface BuildInfo {
  /**
   * The data version every figure on this request was read at (see
   * `dataVersion`). Published in the page head, not on screen, so a check can
   * confirm that a page reflects the database as it is now.
   */
  dataVersion: string | null;
}

export async function getBuildInfo(): Promise<BuildInfo> {
  try {
    return { dataVersion: await dataVersion() };
  } catch {
    // The shell must render even when the database is unreachable, so that the
    // page can show an error state rather than a blank screen.
    return { dataVersion: null };
  }
}
