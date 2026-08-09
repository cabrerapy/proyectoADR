import { expect, test } from "@playwright/test";

const pending = {
  createdAt: "2026-08-09T12:00:00Z", createdBy: "admin-1", currency: "PYG",
  endDate: "2026-09-09", expectedAmount: 250_000, frequency: "MONTHLY",
  id: "membership-1", planId: "plan-1", planName: "Plan mensual",
  standing: "INACTIVE", startDate: "2026-08-09", status: "PENDING",
  updatedAt: "2026-08-09T12:00:00Z", userId: "student-1", version: 1,
} as const;

test("creates and activates a membership once on mobile", async ({ page }) => {
  let posts = 0;
  let patches = 0;
  let memberships: readonly Record<string, unknown>[] = [];
  await page.route("**/api/v1/admin/plans?status=ACTIVE", (route) => route.fulfill({
    contentType: "application/json",
    json: { capabilities: { canManage: true }, plans: [{ id: "plan-1", name: "Plan mensual", price: 250_000 }] },
  }));
  await page.route("**/api/v1/admin/memberships**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ contentType: "application/json", json: { capabilities: { canManageStates: true, canWrite: true }, memberships } });
      return;
    }
    if (method === "POST") {
      posts += 1; memberships = [pending];
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ contentType: "application/json", json: pending, status: 201 });
      return;
    }
    patches += 1;
    memberships = [{ ...pending, standing: "CURRENT", status: "ACTIVE", version: 2 }];
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ contentType: "application/json", json: memberships[0] });
  });

  await page.goto("/admin/memberships");
  await expect(page.getByRole("heading", { name: "Membresías" })).toBeVisible();
  await page.getByLabel("Identificador del alumno").fill("student-1");
  await page.getByRole("button", { name: "Consultar" }).click();
  await expect(page.getByText("Sin membresías")).toBeVisible();
  const create = page.getByRole("heading", { name: "Crear membresía pendiente" }).locator("..");
  await create.getByLabel("Plan activo").selectOption("plan-1");
  await create.getByLabel("Inicio").fill("2026-08-09");
  await create.getByLabel("Vencimiento").fill("2026-09-09");
  await create.getByRole("button", { name: "Crear membresía" }).dblclick();
  await expect(page.getByText("Membresía pendiente creada correctamente.")).toBeVisible();
  expect(posts).toBe(1);
  const edit = page.getByRole("listitem").first().locator("form");
  await edit.getByLabel("Estado", { exact: true }).selectOption("ACTIVE");
  await edit.getByRole("button", { name: "Guardar cambios" }).dblclick();
  await expect(page.getByText("Membresía actualizada correctamente.")).toBeVisible();
  expect(patches).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shows operational controls without state transitions to STAFF", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/admin/plans?status=ACTIVE", (route) => route.fulfill({
    contentType: "application/json", json: { plans: [] },
  }));
  await page.route("**/api/v1/admin/memberships**", (route) => route.fulfill({
    contentType: "application/json",
    json: { capabilities: { canManageStates: false, canWrite: true }, memberships: [pending] },
  }));
  await page.goto("/admin/memberships");
  await page.getByLabel("Identificador del alumno").fill("student-1");
  await page.getByRole("button", { name: "Consultar" }).click();
  await expect(page.getByText("Plan mensual")).toBeVisible();
  await expect(page.getByLabel("Estado", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
});

test("denies an unauthenticated memberships API request", async ({ request }) => {
  const response = await request.get("/api/v1/admin/memberships?userId=student-1");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
});
