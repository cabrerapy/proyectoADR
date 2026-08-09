import { describe, expect, it } from "vitest";

import { getPublicSiteContent } from "./public-site-content";

describe("public site content", () => {
  it("covers every required public information area without real contact data", () => {
    const content = getPublicSiteContent({});

    expect(content.navigation.map(({ href }) => href)).toEqual([
      "/gimnasio",
      "/planes",
      "/horarios",
      "/galeria",
      "/contacto",
    ]);
    expect(content.trainers).not.toHaveLength(0);
    expect(content.facilities).not.toHaveLength(0);
    expect(content.equipment).not.toHaveLength(0);
    expect(content.plans).not.toHaveLength(0);
    expect(content.schedules).not.toHaveLength(0);
    expect(content.whatsappUrl).toBeUndefined();
    expect(content.instagramUrl).toBeUndefined();
    expect(content.facebookUrl).toBeUndefined();
    expect(content.siteUrl).toBe("http://localhost:3000");
  });

  it("builds safe WhatsApp and social links from valid configuration", () => {
    const content = getPublicSiteContent({
      NEXT_PUBLIC_GYM_FACEBOOK_URL: "https://www.facebook.com/gymadr",
      NEXT_PUBLIC_GYM_INSTAGRAM_URL: "https://instagram.com/gymadr",
      NEXT_PUBLIC_GYM_SITE_URL: "https://gym.example.com",
      NEXT_PUBLIC_GYM_WHATSAPP_NUMBER: "+595981123456",
    });

    expect(content.whatsappUrl).toMatch(/^https:\/\/wa\.me\/595981123456\?/u);
    expect(content.instagramUrl).toBe("https://instagram.com/gymadr");
    expect(content.facebookUrl).toBe("https://www.facebook.com/gymadr");
    expect(content.siteUrl).toBe("https://gym.example.com");
  });

  it("rejects unsafe, misleading, or malformed external configuration", () => {
    const content = getPublicSiteContent({
      NEXT_PUBLIC_GYM_FACEBOOK_URL: "javascript:alert(1)",
      NEXT_PUBLIC_GYM_INSTAGRAM_URL: "https://instagram.com.attacker.example/gymadr",
      NEXT_PUBLIC_GYM_SITE_URL: "http://gym.example.com/private",
      NEXT_PUBLIC_GYM_WHATSAPP_NUMBER: "+595123",
    });

    expect(content.whatsappUrl).toBeUndefined();
    expect(content.instagramUrl).toBeUndefined();
    expect(content.facebookUrl).toBeUndefined();
    expect(content.siteUrl).toBe("http://localhost:3000");
  });
});
