import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @parcelpilot/db ships TypeScript source (see its exports map), so Next must transpile it.
  transpilePackages: ["@parcelpilot/db"],
};

export default nextConfig;
