import { expect, test } from "@playwright/test";

const publicRoutes = [
  { heading: "Un espacio para moverte mejor", path: "/gimnasio" },
  { heading: "Una opción para cada ritmo", path: "/planes" },
  { heading: "Encontrá tu momento para entrenar", path: "/horarios" },
  { heading: "Así se vive Gym ADR", path: "/galeria" },
  { heading: "Hablemos de tu entrenamiento", path: "/contacto" },
  { heading: "Empezá tu camino en Gym ADR", path: "/ingreso" },
] as const;

test("exposes every public area from the accessible mobile menu", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Entrená con propósito." })).toBeVisible();

  const menu = page.getByText("Menú", { exact: true });
  await expect(menu).toBeVisible();
  await menu.click();
  const mobileNavigation = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(mobileNavigation.getByRole("link", { name: "El gimnasio" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Planes" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Horarios" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Galería" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Contacto" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Solicitar ingreso" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("renders all public routes and safe empty or provisional states", async ({ page }) => {
  await page.route("**/api/v1/gallery?*", (route) =>
    route.fulfill({ contentType: "application/json", json: { assets: [] } }),
  );
  for (const route of publicRoutes) {
    const response = await page.goto(route.path);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
  }

  await page.goto("/galeria");
  await expect(page.getByText("Aún no hay fotografías publicadas")).toBeVisible();
  await page.goto("/contacto");
  await expect(page.getByText("WhatsApp pendiente de configuración.")).toBeVisible();
  const mapLink = page.getByRole("link", { name: /Abrir ubicación en Google Maps/u });
  await expect(mapLink).toHaveAttribute("target", "_blank");
  await expect(mapLink).toHaveAttribute("rel", "noopener noreferrer");
});

test("supports desktop navigation and the approved authentication entry points", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ingreso");

  await expect(page.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
  await expect(page.getByText("Menú", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Continuar con Google" })).toHaveAttribute("href", "/api/auth/login?provider=Google");
  await expect(page.getByRole("link", { name: "Continuar con Facebook" })).toHaveAttribute("href", "/api/auth/login?provider=Facebook");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
