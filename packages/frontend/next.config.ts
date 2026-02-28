import type { NextConfig } from "next";

const GATEWAY_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
const WALLET_URL =
  process.env.WALLET_SERVICE_URL ||
  "http://localhost:8001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/market/:path*",
        destination: `${GATEWAY_URL}/market/:path*`,
      },
      {
        source: "/health",
        destination: `${GATEWAY_URL}/health`,
      },
      {
        source: "/admin/api/:path*",
        destination: `${GATEWAY_URL}/admin/:path*`,
      },
      {
        source: "/v1/:path*",
        destination: `${WALLET_URL}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
