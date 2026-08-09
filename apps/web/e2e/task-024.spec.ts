import { expect, test } from "@playwright/test";

test("publishes canonical metadata and excludes private routes from discovery", async ({ page, request }) => {
  await page.goto("/gimnasio");

  await expect(page).toHaveTitle("El gimnasio | Gym ADR");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:3000/gimnasio",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /entrenadores, instalaciones y equipamiento/u,
  );

  const sitemapResponse = await request.get("/sitemap.xml");
  const sitemapBody = await sitemapResponse.text();
  expect(sitemapResponse.ok()).toBe(true);
  expect(sitemapBody).toContain("http://localhost:3000/galeria");
  expect(sitemapBody).not.toContain("/onboarding");

  const robotsResponse = await request.get("/robots.txt");
  const robotsBody = await robotsResponse.text();
  expect(robotsBody).toContain("Disallow: /api/");
  expect(robotsBody).toContain("Disallow: /onboarding");
});

test("separates public edge caching from private responses", async ({ request }) => {
  const publicResponse = await request.get("/planes");
  const privatePageResponse = await request.get("/onboarding");
  const apiResponse = await request.get("/api/v1/health");

  expect(publicResponse.headers()["cache-control"]).toContain("s-maxage=3600");
  expect(privatePageResponse.headers()["cache-control"]).toContain("no-store");
  expect(apiResponse.headers()["cache-control"]).toContain("no-store");
});

test("meets the local public-page performance budget", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let largestContentfulPaint = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) largestContentfulPaint = entry.startTime;
    });
    observer.observe({ buffered: true, type: "largest-contentful-paint" });
    Object.defineProperty(window, "__gymLargestContentfulPaint", {
      get: () => largestContentfulPaint,
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(100);

  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const criticalBytes = performance
      .getEntriesByType("resource")
      .filter((entry) => ["script", "css"].includes((entry as PerformanceResourceTiming).initiatorType))
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0);
    const measuredWindow = window as Window & { __gymLargestContentfulPaint?: number };

    return {
      criticalBytes,
      documentBytes: new Blob([document.documentElement.outerHTML]).size,
      largestContentfulPaint: measuredWindow.__gymLargestContentfulPaint ?? 0,
      navigationDuration: navigation?.duration ?? 0,
    };
  });

  await testInfo.attach("public-page-performance.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });

  expect(metrics.documentBytes).toBeLessThan(100_000);
  expect(metrics.criticalBytes).toBeLessThan(750_000);
  expect(metrics.navigationDuration).toBeLessThan(5_000);
  expect(metrics.largestContentfulPaint).toBeGreaterThan(0);
  expect(metrics.largestContentfulPaint).toBeLessThanOrEqual(2_500);
});
