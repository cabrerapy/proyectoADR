import { expect, test } from "@playwright/test";

const profile = {
  displayName: "María Núñez",
  email: "maria@example.com",
  emailNotificationsEnabled: true,
  joinedAt: "2026-08-08T12:00:00.000Z",
  onboardingCompleted: true,
  phone: "+595981123456",
  roles: ["STUDENT"],
  status: "ACTIVE",
  updatedAt: "2026-08-08T12:10:00.000Z",
  version: 2,
} as const;

test("updates only contact and preference fields without double submission", async ({ page }) => {
  let patches = 0;
  await page.route("**/api/v1/me/profile", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: profile });
      return;
    }
    patches += 1;
    expect(route.request().postDataJSON()).toEqual({
      displayName: "María Benítez",
      emailNotificationsEnabled: false,
      expectedVersion: 2,
      phone: "+595981999999",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...profile,
        displayName: "María Benítez",
        emailNotificationsEnabled: false,
        phone: "+595981999999",
        version: 3,
      },
    });
  });

  await page.goto("/me/profile");
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(page.getByText("maria@example.com")).toBeVisible();
  await expect(page.getByText("Activo", { exact: true })).toBeVisible();
  await expect(page.getByText("Alumno", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Correo verificado")).toHaveCount(0);
  await page.getByLabel("Nombre y apellido").fill("María Benítez");
  await page.getByLabel("Teléfono").fill("+595981999999");
  await page.getByLabel("Recibir notificaciones por correo").uncheck();
  const submit = page.getByRole("button", { name: "Guardar cambios" });
  await submit.dblclick();
  await expect(page.getByText("Tus datos se actualizaron correctamente.")).toBeVisible();
  expect(patches).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shows incomplete and error states accessibly on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/me/profile", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { ...profile, onboardingCompleted: false, phone: undefined },
    })
  );
  await page.goto("/me/profile");
  await expect(page.getByRole("heading", { name: "Primero completá tu solicitud" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Completar perfil inicial" })).toHaveAttribute("href", "/onboarding");

  await page.unroute("**/api/v1/me/profile");
  await page.route("**/api/v1/me/profile", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { message: "Tu sesión no es válida o expiró." },
      status: 401,
    })
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "No pudimos mostrar tu perfil" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByLabel("Teléfono")).toHaveCount(0);
});

test("denies an unauthenticated own-profile request", async ({ request }) => {
  const response = await request.get("/api/v1/me/profile");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});
