/**
 * Runs once when the server starts.
 *
 * Opens the database connections ahead of the first visitor, so the first page
 * does not pay the pooler handshake. It deliberately does not keep the pool
 * warm on a timer: on Vercel a recurring timer keeps a function instance busy
 * and querying the database around the clock, with nobody visiting, and that
 * background load is what pushed the team over its fair-use limits. Every
 * failure is ignored.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { warmPool } = await import("@/lib/db/client");
    await warmPool();
  } catch {
    // Left to the first requests.
  }
}
