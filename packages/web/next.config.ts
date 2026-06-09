import type { NextConfig } from "next";

// Kept deliberately minimal. The dashboard reads from the ingest REST API at
// runtime, so there is no special build-time data wiring to configure here yet.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
