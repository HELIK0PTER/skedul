import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Support requests send up to 3 images of 5 MB through Server Actions.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
