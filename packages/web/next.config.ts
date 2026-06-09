import type { NextConfig } from "next";

// The dashboard reads from the ingest REST API at runtime. We transpile the
// shared schema package so its workspace source resolves cleanly in the bundle.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@overseer/schema"],
};

export default nextConfig;
