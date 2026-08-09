import type { NextConfig } from "next";
import path from "node:path";

const tracingRoot = process.env.OPEN_NEXT_MONOREPO_ROOT ??
  path.join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: tracingRoot,
  poweredByHeader: false,
  transpilePackages: [
    "@gym-adr/data-access",
    "@gym-adr/domain",
    "@gym-adr/shared",
    "@gym-adr/validation",
  ],
};

export default nextConfig;
