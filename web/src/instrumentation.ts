/**
 * Runs once when the server starts.
 *
 * Opens the two database connections ahead of the first visitor, so nobody pays
 * the pooler handshake on the first page. Then touches the pool every 50
 * seconds: idle connections close after 60 seconds, and without this the
 * replacement was opened on a visitor's request. The timer is unreferenced,
 * so it never keeps the process alive, and every failure is ignored.
 */
const KEEP_WARM_MS = 50 * 1000;

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
