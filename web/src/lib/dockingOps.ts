/**
 * The docking operations pages (/docking, /docking/[jobId]) and their API
 * (/api/docking/*) are for the machine running the campaign, not the public
 * site. They exist only where AMR_DOCKING_OPS=1 is set (web/.env.local on the
 * operator's PC). Medicine pages show docking scores everywhere.
 */
export function dockingOpsEnabled(): boolean {
  return process.env.AMR_DOCKING_OPS === "1";
}
