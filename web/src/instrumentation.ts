/**
 * Runs once when the server starts.
 *
 * Opens the database connection pool ahead of the first visitor, so nobody pays
 * the pooler handshake (about 2.5 s from this machine) on the first pages. Then
 * touches the pool every four minutes: connections are retired after a while
 * and idle ones close after five minutes, and without this the replacement was
 * opened on a visitor's request. The timer is unreferenced, so it never keeps
 * the process alive, and every failure is ignored: requests still open
 * connections as they always did.
 */
const KEEP_WARM_MS = 4 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { warmPool } = await import("@/lib/db/client");
    await warmPool();
    const timer = setInterval(() => {
      void warmPool().catch(() => {});
    }, KEEP_WARM_MS);
    timer.unref?.();
  } catch {
    // Left to the first requests.
  }
}
