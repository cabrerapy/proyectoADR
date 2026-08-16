import { expect, test } from "@playwright/test";

test("mantiene shell público accesible y presupuesto local de respuesta", async ({ page }) => {
  const startedAt = Date.now();
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("main")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Ir al contenido principal" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("la API administrativa niega una solicitud sin sesión sin filtrar detalles", async ({ request }) => {
  const response = await request.get("/api/v1/admin/dashboard");
  expect(response.status()).toBe(401);
  const body = await response.text();
  expect(body).not.toMatch(/stack|token|cookie|secret/iu);
});
