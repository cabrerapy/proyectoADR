import type { NextConfig } from "next";
import path from "node:path";

const tracingRoot = process.env.OPEN_NEXT_MONOREPO_ROOT ??
  path.join(import.meta.dirname, "../..");

const publicCacheControl =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const privateCacheControl = "private, no-store, max-age=0";
const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; connect-src 'self' https://*.amazoncognito.com; font-src 'self'; form-action 'self' https://*.amazoncognito.com; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;
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
      { headers: [...securityHeaders], source: "/:path*" },
      ...publicRoutes.map((source) => ({
        headers: [{ key: "Cache-Control", value: publicCacheControl }],
        source,
      })),
      {
        headers: [{ key: "Cache-Control", value: privateCacheControl }],
        source: "/onboarding",
      },
      {
        headers: [{ key: "Cache-Control", value: privateCacheControl }],
        source: "/me/:path*",
      },
      {
        headers: [{ key: "Cache-Control", value: privateCacheControl }],
        source: "/admin/:path*",
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
