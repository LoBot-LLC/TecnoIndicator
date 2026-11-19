import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: false,
  },
};

export default nextConfig;
