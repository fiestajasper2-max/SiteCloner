import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Route handlers are unaffected; binary assets stream through /api/proxy to stay under Vercel's 4.5 MB response cap
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
