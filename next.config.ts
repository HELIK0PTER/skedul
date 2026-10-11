import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vercel's request-body cap: support images are shrunk in the browser to
    // 1.3 MB or less each (src/lib/shrink-image.ts) before the Server Action.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
