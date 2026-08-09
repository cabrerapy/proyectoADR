import { expect, test } from "@playwright/test";

test("starts social login with PKCE and protected transaction cookies", async ({
  request,
}) => {
  const response = await request.get("/api/auth/login?provider=Google", {
    maxRedirects: 0,
  });
  const location = new URL(response.headers().location ?? "");
  const cookies = response.headers()["set-cookie"] ?? "";

  expect(response.status()).toBe(302);
  expect(location.pathname).toBe("/oauth2/authorize");
  expect(location.searchParams.get("identity_provider")).toBe("Google");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(cookies).toContain("HttpOnly");
  expect(cookies).toContain("SameSite=Lax");
  expect(cookies).not.toContain("gym_session=");
});
