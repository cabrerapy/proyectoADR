import { expect, test } from "@playwright/test";

const plan = {
  createdAt: "2026-08-09T12:00:00Z",
  createdBy: "admin-1",
  currency: "PYG",
  description: "Acceso mensual",
  frequency: "MONTHLY",
  id: "plan-1",
  name: "Plan mensual",
  price: 250_000,
  status: "ACTIVE",
  updatedAt: "2026-08-09T12:00:00Z",
  updatedBy: "admin-1",
  version: 1,
} as const;

test("creates and logically deactivates a plan once on mobile", async ({ page }) => {
  let posts = 0;
  let patches = 0;
  let current = {
    ...plan,
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
    version: 1 as number,
  };
  await page.route("**/api/v1/admin/plans**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ contentType: "application/json", json: { capabilities: { canManage: true }, plans: posts === 0 ? [current] : [current] } });
      return;
    }
    if (method === "POST") {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ contentType: "application/json", json: plan, status: 201 });
      return;
    }
    patches += 1;
    const body = route.request().postDataJSON() as { status: string };
    current = { ...plan, status: body.status as "ACTIVE" | "INACTIVE", version: 2 };
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ contentType: "application/json", json: current });
  });

  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Planes de membresía" })).toBeVisible();
  const createForm = page.getByRole("heading", { name: "Crear plan" }).locator("..");
  await createForm.getByLabel("Nombre").fill("Plan trimestral");
  await createForm.getByLabel("Precio en guaraníes").fill("600000");
  await createForm.getByRole("button", { name: "Crear plan" }).dblclick();
  await expect(page.getByText("Plan creado correctamente.")).toBeVisible();
  expect(posts).toBe(1);

  const editForm = page.getByRole("listitem").first().locator("form");
  await editForm.getByLabel("Estado").selectOption("INACTIVE");
  await editForm.getByRole("button", { name: "Guardar cambios" }).dblclick();
  await expect(page.getByText(/cambios guardados/u)).toBeVisible();
  expect(patches).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shows read-only plans to STAFF and safe errors", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/admin/plans**", (route) => route.fulfill({
    contentType: "application/json",
    json: { capabilities: { canManage: false }, plans: [plan] },
  }));
  await page.goto("/admin/plans");
  await expect(page.getByText("Plan mensual")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crear plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);

  await page.route("**/api/v1/admin/plans**", (route) => route.fulfill({
    contentType: "application/json",
    json: { message: "El estado o los permisos de tu cuenta no permiten esta operación." },
    status: 403,
  }));
  await page.reload();
  await expect(page.getByText("El estado o los permisos de tu cuenta no permiten esta operación.")).toBeVisible();
});

test("denies an unauthenticated plans API request", async ({ request }) => {
  const response = await request.get("/api/v1/admin/plans?status=ALL");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});
