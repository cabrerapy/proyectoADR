import { readFile } from "node:fs/promises";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

describe("site shell", () => {
  it("renders labelled navigation and a location-aware footer", () => {
    const header = renderToStaticMarkup(<SiteHeader />);
    const footer = renderToStaticMarkup(<SiteFooter />);

    expect(header).toContain("<header");
    expect(header).toContain('aria-label="Navegación principal"');
    expect(header).toContain('href="/"');
    expect(footer).toContain("<footer");
    expect(footer).toContain("Limpio, Paraguay");
  });

  it("defines visual tokens, visible focus, and a skip-link state", async () => {
    const styles = await readFile(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain("--gym-color-brand-900");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("outline: 3px solid");
    expect(styles).toContain(".skip-link:focus");
  });
});
