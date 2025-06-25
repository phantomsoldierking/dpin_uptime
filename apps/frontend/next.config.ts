import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${api}/:path*`,
      },
    ];
  },
};

export default nextConfig;
