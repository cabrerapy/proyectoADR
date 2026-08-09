import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next.js public delivery configuration", () => {
  it("uses modern responsive image formats and bounded device sizes", () => {
    expect(nextConfig.images).toMatchObject({
      deviceSizes: [360, 640, 768, 1024, 1280, 1536],
      formats: ["image/avif", "image/webp"],
      imageSizes: [32, 64, 96, 160, 256, 320],
    });
  });

  it("caches public pages at the edge and never caches private routes", async () => {
    const headers = await nextConfig.headers?.();
    expect(headers).toBeDefined();

    const cacheValue = (source: string): string | undefined =>
      headers
        ?.find((entry) => entry.source === source)
        ?.headers.find((header) => header.key === "Cache-Control")?.value;

    expect(cacheValue("/")).toContain("s-maxage=3600");
    expect(cacheValue("/galeria")).toContain("stale-while-revalidate=86400");
    expect(cacheValue("/api/:path*")).toBeUndefined();
    expect(cacheValue("/onboarding")).toBe("private, no-store, max-age=0");
    expect(cacheValue("/me/:path*")).toBe("private, no-store, max-age=0");
    expect(cacheValue("/admin/:path*")).toBe("private, no-store, max-age=0");
  });
});
