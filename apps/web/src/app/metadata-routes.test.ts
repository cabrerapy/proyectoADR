import { describe, expect, it } from "vitest";

import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("public metadata routes", () => {
  it("publishes only public pages in the sitemap", () => {
    const urls = sitemap().map(({ url }) => url);

    expect(urls).toEqual([
      "http://localhost:3000",
      "http://localhost:3000/gimnasio",
      "http://localhost:3000/planes",
      "http://localhost:3000/horarios",
      "http://localhost:3000/galeria",
      "http://localhost:3000/contacto",
      "http://localhost:3000/ingreso",
    ]);
    expect(urls.some((url) => url.includes("/api/") || url.includes("/onboarding"))).toBe(false);
  });

  it("keeps private and authenticated paths out of crawlers", () => {
    const rules = robots();

    expect(rules.sitemap).toBe("http://localhost:3000/sitemap.xml");
    expect(rules.rules).toMatchObject({
      allow: "/",
      disallow: ["/api/", "/admin/", "/me/", "/onboarding"],
      userAgent: "*",
    });
  });

  it("provides an installable Spanish manifest", () => {
    expect(manifest()).toMatchObject({
      display: "standalone",
      lang: "es-PY",
      name: "Gym ADR",
      start_url: "/",
    });
  });
});
