import { expect, test } from "@playwright/test";

test("submits only editable onboarding fields and shows the pending success state", async ({ page }) => {
  await page.route("**/api/v1/onboarding", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          completed: false,
          displayName: "María Núñez",
          email: "maria@example.com",
          status: "PENDING",
          version: 1,
        },
      });
      return;
    }
    const payload: unknown = route.request().postDataJSON();
    expect(payload).toEqual({
      displayName: "María Benítez",
      expectedVersion: 1,
      phone: "+595981123456",
    });
    await route.fulfill({
      contentType: "application/json",
      json: {
        completed: true,
        displayName: "María Benítez",
        email: "maria@example.com",
        phone: "+595981123456",
        status: "PENDING",
        version: 2,
      },
    });
  });

  await page.goto("/onboarding");
  await page.getByLabel("Nombre y apellido").fill("María Benítez");
  await page.getByLabel("Teléfono").fill("+595981123456");
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByText("Perfil enviado correctamente")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu solicitud está pendiente" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});

test("shows a responsive expired-session state without exposing profile fields", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Tu sesión no está disponible" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Iniciar sesión nuevamente" })).toBeVisible();
  await expect(page.getByLabel("Teléfono")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test("rejects an invalid session and clears logout cookie only from an approved origin", async ({ request }) => {
  const profile = await request.get("/api/v1/onboarding", {
    headers: { cookie: "gym_session=expired-or-invalid" },
  });
  expect(profile.status()).toBe(401);
  expect(await profile.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

  const rejected = await request.post("/api/auth/logout", {
    headers: { origin: "https://attacker.example" },
    maxRedirects: 0,
  });
  expect(rejected.status()).toBe(403);

  const logout = await request.post("/api/auth/logout", {
    headers: { origin: "http://localhost:3100" },
    maxRedirects: 0,
  });
  expect(logout.status()).toBe(302);
  expect(logout.headers().location).toContain("/logout?");
  expect(logout.headers()["set-cookie"]).toContain("gym_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
});
