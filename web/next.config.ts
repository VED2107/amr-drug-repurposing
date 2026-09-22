import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    RDKit ships an Emscripten bundle that loads its own .wasm from disk at
    runtime. Bundling it breaks that lookup, so it stays an external server
    package — it runs in Node, draws the SVG, and never reaches the browser.
  */
  serverExternalPackages: ["@rdkit/rdkit"],
};

export default nextConfig;
