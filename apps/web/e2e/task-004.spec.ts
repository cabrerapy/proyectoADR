import { expect, test } from "@playwright/test";

const relativeLuminance = (color: string): number => {
  const channels = color.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number);

  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported color: ${color}`);
  }

  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });

  const red = linear[0];
  const green = linear[1];
  const blue = linear[2];

  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Incomplete color: ${color}`);
  }

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );

  return (lighter + 0.05) / (darker + 0.05);
};

test("provides an accessible mobile-first shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Gym ADR");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const skipLink = page.getByRole("link", {
    name: "Ir al contenido principal",
  });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const presentation = await page.evaluate(() => {
    const styles = window.getComputedStyle(document.body);

    return {
      background: styles.backgroundColor,
      foreground: styles.color,
      hasHorizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(presentation.viewportWidth).toBe(360);
  expect(presentation.hasHorizontalOverflow).toBe(false);
  expect(contrastRatio(presentation.foreground, presentation.background)).toBeGreaterThanOrEqual(
    4.5,
  );
});
