import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/playwright-core/**",
      "node_modules/@sparticuz/chromium/**",
    ],
  },
};

export default nextConfig;
