import type { NextConfig } from "next";

/*
  The site used to have fifteen sections. It is now the overview, the dashboard
  and the investigation view. Old links still land somewhere sensible: a
  medicine's old page opens its investigation, and every other retired section
  opens the dashboard, which now holds what was worth keeping from it.
*/
const RETIRED = [
  "/screening",
  "/candidates",
  "/medicines",
  "/case-study",
  "/explorer",
  "/molecular",
  "/docking",
  "/clinical",
  "/models",
  "/pipeline",
  "/retraining",
  "/roadmap",
  "/runs",
];

const nextConfig: NextConfig = {
  serverExternalPackages: [
    /*
      RDKit ships an Emscripten bundle that loads its own .wasm from disk at
      runtime. Bundling it breaks that lookup, so it stays an external server
      package: it runs in Node, draws the structure SVG, and never reaches the
      browser.
    */
    "@rdkit/rdkit",

    /*
      better-sqlite3 is a native module, and only the local development driver
      ever loads it: production reads Supabase. It is listed here so the bundler
      leaves the `await import("better-sqlite3")` in `lib/db/client.ts` alone
      instead of trying to resolve a compiled `.node` binding at build time.

      This matters on a host that installs dependencies without running their
      install scripts — the binding is never built there, so bundling it fails
      a build that has no intention of using it.
    */
    "better-sqlite3",
  ],

  async redirects() {
    return [
      { source: "/medicines/:moleculeId", destination: "/investigate/:moleculeId", permanent: false },
      ...RETIRED.map((source) => ({ source, destination: "/dashboard", permanent: false })),
    ];
  },
};

export default nextConfig;
