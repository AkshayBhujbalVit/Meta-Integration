import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle — required for the Docker runner stage
  output: "standalone",
};

export default nextConfig;
