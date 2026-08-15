import { expect, test, type Locator, type Page } from "@playwright/test";

const links = [
  { description: "Solicitudes y búsqueda paginada.", href: "/admin/students", label: "Alumnos" },
  { description: "Carga y publicación.", href: "/admin/gallery", label: "Galería" },
];

const reachByKeyboard = async (page: Page, target: Locator): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("El enlace no fue alcanzable mediante Tab.");
};

for (const role of ["STAFF", "ADMIN"] as const) {
  test(`renders a responsive keyboard-accessible dashboard for ${role}`, async ({ page }) => {
    await page.route("**/api/v1/admin/dashboard", (route) => route.fulfill({ contentType: "application/json", json: { links, role } }));
    await page.setViewportSize(role === "STAFF" ? { height: 800, width: 360 } : { height: 900, width: 1280 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Panel del gimnasio" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Módulos administrativos" })).toBeVisible();
    const studentsLink = page.getByRole("link", { name: /Alumnos/u });
    await reachByKeyboard(page, studentsLink);
    await expect(studentsLink).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test("shows a safe denied state for a student or missing session", async ({ page }) => {
  await page.route("**/api/v1/admin/dashboard", (route) => route.fulfill({ contentType: "application/json", json: { message: "El estado o los permisos de tu cuenta no permiten esta operación." }, status: 403 }));
  await page.goto("/admin");
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos cargar el panel" })).toContainText("permisos");
  await expect(page.getByRole("navigation", { name: "Módulos administrativos" })).toHaveCount(0);
});
