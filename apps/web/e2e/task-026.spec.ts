import { expect, test } from "@playwright/test";

const student = {
  createdAt: "2026-08-08T12:00:00.000Z",
  displayName: "Ana López",
  email: "ana@example.com",
  id: "student-1",
  onboardingCompleted: true,
  phone: "+595981123456",
  roles: ["STUDENT"],
  status: "PENDING",
  updatedAt: "2026-08-08T12:10:00.000Z",
  version: 2,
} as const;

test("reviews a pending application once from the responsive admin list", async ({ page }) => {
  let patches = 0;
  await page.route("**/api/v1/admin/students**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          capabilities: { canManageStatus: true, canReadFull: true },
          students: [student],
        },
      });
      return;
    }
    patches += 1;
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 2, status: "ACTIVE" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      contentType: "application/json",
      json: { ...student, status: "ACTIVE", version: 3 },
    });
  });

  await page.goto("/admin/students");
  await expect(page.getByRole("heading", { name: "Alumnos y solicitudes" })).toBeVisible();
  await expect(page.getByText("ana@example.com")).toBeVisible();
  await page.getByLabel("Nuevo estado").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Confirmar cambio" }).dblclick();
  await expect(page.getByText("Ana López: estado actualizado a Activo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No hay resultados" })).toBeVisible();
  expect(patches).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shows operational-only results to STAFF without administrative controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/admin/students**", (route) => route.fulfill({
    contentType: "application/json",
    json: {
      capabilities: { canManageStatus: false, canReadFull: false },
      students: [{
        createdAt: student.createdAt,
        displayName: student.displayName,
        id: student.id,
        onboardingCompleted: true,
        status: student.status,
        updatedAt: student.updatedAt,
        version: student.version,
      }],
    },
  }));

  await page.goto("/admin/students");
  await expect(page.getByText("Ana López")).toBeVisible();
  await expect(page.getByText("ana@example.com")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirmar cambio" })).toHaveCount(0);
});

test("shows safe error and denies an unauthenticated admin request", async ({ page, request }) => {
  await page.route("**/api/v1/admin/students**", (route) => route.fulfill({
    contentType: "application/json",
    json: { message: "El estado o los permisos de tu cuenta no permiten esta operación." },
    status: 403,
  }));
  await page.goto("/admin/students");
  await expect(page.getByText("El estado o los permisos de tu cuenta no permiten esta operación.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No hay resultados" })).toBeVisible();

  const response = await request.get("/api/v1/admin/students?filter=pending");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});
