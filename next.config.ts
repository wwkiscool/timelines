import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    const backend = (process.env.BACKEND_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
    return [{ source: "/api/timeline/:path*", destination: `${backend}/api/timeline/:path*` }];
  },
};

export default nextConfig;
