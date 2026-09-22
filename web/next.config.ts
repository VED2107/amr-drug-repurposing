import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    /*
      RDKit ships an Emscripten bundle that loads its own .wasm from disk at
      runtime. Bundling it breaks that lookup, so it stays an external server
      package — it runs in Node, draws the SVG, and never reaches the browser.
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
};

export default nextConfig;
