import { expect, test } from "@playwright/test";

const membership = {
  createdAt: "2026-08-09T12:00:00Z", createdBy: "admin-1", currency: "PYG",
  endDate: "2026-09-09", expectedAmount: 250_000, frequency: "MONTHLY",
  id: "membership-1", planId: "plan-1", planName: "Plan mensual",
  standing: "CURRENT", startDate: "2026-08-09", status: "ACTIVE",
  updatedAt: "2026-08-09T12:00:00Z", userId: "student-1", version: 1,
} as const;

test("shows only the authenticated student's membership on mobile", async ({ page }) => {
  const urls: string[] = [];
  await page.route("**/api/v1/me/membership**", (route) => {
    urls.push(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      json: { active: membership, history: [membership] },
    });
  });
  await page.goto("/me/membership");
  await expect(page.getByRole("heading", { name: "Mi membresía" })).toBeVisible();
  await expect(page.getByText("Plan mensual").first()).toBeVisible();
  await expect(page.getByText("Activa · Vigente").first()).toBeVisible();
  expect(urls.every((url) => !new URL(url).searchParams.has("userId"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("paginates an administrative due report and renders empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let calls = 0;
  await page.route("**/api/v1/admin/membership-reports**", async (route) => {
    calls += 1;
    const url = new URL(route.request().url());
    if (url.searchParams.get("value") === "2026-09-10") {
      await route.fulfill({ contentType: "application/json", json: { memberships: [] } });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: calls === 1
        ? { cursor: "next_cursor", memberships: [membership] }
        : { memberships: [{ ...membership, id: "membership-2", userId: "student-2" }] },
    });
  });
  await page.goto("/admin/membership-reports");
  await page.getByLabel("Fecha de vencimiento").fill("2026-09-09");
  await page.getByRole("button", { name: "Consultar reporte" }).click();
  await expect(page.getByText("student-1")).toBeVisible();
  await page.getByRole("button", { name: "Cargar más" }).click();
  await expect(page.getByText("student-2")).toBeVisible();
  await page.getByLabel("Fecha de vencimiento").fill("2026-09-10");
  await page.getByRole("button", { name: "Consultar reporte" }).click();
  await expect(page.getByRole("heading", { name: "Sin resultados" })).toBeVisible();
});

test("denies unauthenticated membership views", async ({ request }) => {
  const own = await request.get("/api/v1/me/membership");
  const report = await request.get("/api/v1/admin/membership-reports?filter=status&value=ACTIVE");
  expect(own.status()).toBe(401);
  expect(report.status()).toBe(401);
});
