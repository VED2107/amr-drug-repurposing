import "server-only";

import { queryOne } from "@/lib/db/client";

export interface BuildInfo {
  datasetVersion: string | null;
  featureVersion: string | null;
  /** Date of the most recent completed pipeline run, as a snapshot marker. */
  snapshot: string | null;
}

/**
 * Build provenance for the footer and header.
 *
 * Read from the ACTIVE models rather than hardcoded, so that retraining moves
 * the figure in the footer without anyone editing a constant. If the database
 * has no ACTIVE model, every field is null and the interface says
 * "unavailable" rather than showing a stale value.
 */
export async function getBuildInfo(): Promise<BuildInfo> {
  try {
    const row = await queryOne<Record<string, unknown>>(`
      select
        (select dataset_version from model_versions
          where status = 'ACTIVE' order by training_date desc limit 1) as dataset_version,
        (select feature_version from model_versions
          where status = 'ACTIVE' order by training_date desc limit 1) as feature_version,
        (select max(started_at) from pipeline_runs)                    as snapshot
    `);
    if (!row) return { datasetVersion: null, featureVersion: null, snapshot: null };

    const snapshot = row.snapshot == null ? null : String(row.snapshot).slice(0, 10);
    return {
      datasetVersion: row.dataset_version == null ? null : String(row.dataset_version),
      featureVersion: row.feature_version == null ? null : String(row.feature_version),
      snapshot,
    };
  } catch {
    // The shell must render even when the database is unreachable, so that the
    // page can show an error state rather than a blank screen.
    return { datasetVersion: null, featureVersion: null, snapshot: null };
  }
}
