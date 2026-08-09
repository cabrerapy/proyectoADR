import type { NextConfig } from "next";
import path from "node:path";

const tracingRoot = process.env.OPEN_NEXT_MONOREPO_ROOT ??
  path.join(import.meta.dirname, "../..");

const publicCacheControl =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const privateCacheControl = "private, no-store, max-age=0";
const publicRoutes = [
  "/",
  "/gimnasio",
  "/planes",
  "/horarios",
  "/galeria",
  "/contacto",
  "/ingreso",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
] as const;

const nextConfig: NextConfig = {
  async headers() {
    return [
      ...publicRoutes.map((source) => ({
        headers: [{ key: "Cache-Control", value: publicCacheControl }],
        source,
      })),
      {
        headers: [{ key: "Cache-Control", value: privateCacheControl }],
        source: "/onboarding",
      },
    ];
  },
  images: {
    deviceSizes: [360, 640, 768, 1024, 1280, 1536],
    formats: ["image/avif", "image/webp"],
    imageSizes: [32, 64, 96, 160, 256, 320],
  },
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
