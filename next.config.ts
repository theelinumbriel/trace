import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PGlite (dev-fallback DB) must load its WASM from node_modules at
  // runtime — bundling it breaks its asset resolution.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
