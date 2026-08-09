import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type { CreatePendingUserResult } from "@gym-adr/data-access";
import type { UserProfile } from "@gym-adr/domain";
import { validateCompleteProfile } from "@gym-adr/validation";
import { describe, expect, it, vi } from "vitest";

import { resolveAuthConfig, type AuthConfig } from "./auth-config";
import { AuthService, type PendingUserPort } from "./auth-service";
import { CognitoTokenClient, type CognitoTokenPort } from "./cognito-client";
import { oauthCookieNames, sessionCookieName } from "./cookies";
import { FixedWindowRateLimiter } from "./rate-limiter";

const config: AuthConfig = {
  appBaseUrl: "https://app.example.com",
  callbackUrl: "https://app.example.com/api/auth/callback/cognito",
  clientId: "client-123",
  environment: "development",
  hostedUiBaseUrl: "https://gym.auth.us-east-1.amazoncognito.com",
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example",
  jwksUrl: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example/.well-known/jwks.json",
  tokenUrl: "https://gym.auth.us-east-1.amazoncognito.com/oauth2/token",
};

const cookieHeader = (response: Response): string => {
  const values = response.headers.getSetCookie();
  return values.map((value) => value.split(";", 1)[0]).join("; ");
};

describe("authentication configuration", () => {
  it("accepts exact remote URLs and derives the Cognito issuer", () => {
    expect(resolveAuthConfig({
      APP_BASE_URL: config.appBaseUrl,
      APP_ENVIRONMENT: "development",
      AWS_REGION: "us-east-1",
      COGNITO_CLIENT_ID: config.clientId,
      COGNITO_HOSTED_UI_BASE_URL: config.hostedUiBaseUrl,
      COGNITO_REDIRECT_URI: config.callbackUrl,
      COGNITO_USER_POOL_ID: "us-east-1_Example",
    })).toEqual(config);
  });

  it("rejects an unapproved callback origin", () => {
    expect(() => resolveAuthConfig({
      APP_BASE_URL: config.appBaseUrl,
      APP_ENVIRONMENT: "development",
      AWS_REGION: "us-east-1",
      COGNITO_CLIENT_ID: config.clientId,
      COGNITO_HOSTED_UI_BASE_URL: config.hostedUiBaseUrl,
      COGNITO_REDIRECT_URI: "https://attacker.example/api/auth/callback/cognito",
      COGNITO_USER_POOL_ID: "us-east-1_Example",
    })).toThrow("Invalid Cognito callback URL");
  });
});

describe("OAuth session service", () => {
  const identity = {
    cognitoSub: "subject-001",
    displayName: "María Núñez",
    email: "maria@example.com",
    emailVerified: true,
  } as const;

  const setup = () => {
    const users = new Map<string, Parameters<PendingUserPort["createPending"]>[0]>();
    const completed = new Map<string, UserProfile>();
    const toProfile = (
      stored: Parameters<PendingUserPort["createPending"]>[0],
    ): UserProfile => completed.get(stored.userId) ?? {
      createdAt: stored.createdAt,
      displayName: stored.displayName,
      email: stored.email,
      emailVerified: true,
      id: stored.userId,
      roles: ["STUDENT"],
      status: "PENDING",
      updatedAt: stored.createdAt,
      version: 1,
    };
    const userPort: PendingUserPort = {
      completePendingProfile: vi.fn(async (input) => {
        const stored = [...users.values()].find((entry) => entry.userId === input.userId);
        if (stored === undefined) throw new Error("missing test user");
        const profile: UserProfile = {
          ...toProfile(stored),
          displayName: input.displayName,
          onboardingCompletedAt: input.onboardingCompletedAt,
          phone: input.phone,
          updatedAt: input.onboardingCompletedAt,
          version: input.expectedVersion + 1,
        };
        completed.set(input.userId, profile);
        return profile;
      }),
      createPending: vi.fn(async (input) => {
        const existing = users.get(input.cognitoSub);
        users.set(input.cognitoSub, existing ?? input);
        const stored = existing ?? input;
        const result: CreatePendingUserResult = {
          disposition: existing === undefined ? "CREATED" : "EXISTING",
          profile: toProfile(stored),
        };
        return result;
      }),
      findByCognitoSub: vi.fn(async (sub) => {
        const stored = users.get(sub);
        return stored === undefined ? undefined : toProfile(stored);
      }),
    };
    const tokens: CognitoTokenPort = {
      exchangeCode: vi.fn(async () => "signed-id-token"),
      verifyIdToken: vi.fn(async () => identity),
      verifySessionToken: vi.fn(async () => identity),
    };
    let sequence = 0;
    const service = new AuthService({
      clock: () => new Date("2026-08-08T12:00:00Z"),
      config,
      ids: () => `user-${++sequence}`,
      rateLimiter: new FixedWindowRateLimiter(() => 1),
      tokens,
      users: userPort,
    });
    return { completed, service, tokens, userPort, users };
  };

  it("starts authorization with state, nonce, S256 PKCE and hardened cookies", () => {
    const { service } = setup();
    const response = service.beginLogin(new Request("https://app.example.com/api/auth/login?provider=Google"));
    const destination = new URL(response.headers.get("location") ?? "");
    const cookies = response.headers.getSetCookie();

    expect(response.status).toBe(302);
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    expect(destination.searchParams.get("identity_provider")).toBe("Google");
    expect(destination.searchParams.get("state")).toMatch(/^[\w-]{43}$/u);
    expect(destination.searchParams.get("nonce")).toMatch(/^[\w-]{43}$/u);
    expect(cookies).toHaveLength(3);
    expect(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Secure"))).toBe(true);
    expect(cookies.join(";")).not.toContain("signed-id-token");
  });

  it("rejects a callback with mismatched state before exchanging the code", async () => {
    const { service, tokens } = setup();
    await expect(service.completeCallback(new Request(
      "https://app.example.com/api/auth/callback/cognito?code=valid-code&state=wrong",
      { headers: { cookie: `${oauthCookieNames.state}=expected; ${oauthCookieNames.nonce}=nonce; ${oauthCookieNames.verifier}=verifier` } },
    ))).rejects.toMatchObject({ code: "AUTHENTICATION_INVALID", status: 400 });
    expect(tokens.exchangeCode).not.toHaveBeenCalled();
  });

  it("creates one PENDING user on repeated valid callbacks and sets only an HttpOnly session", async () => {
    const { service, users } = setup();
    const login = service.beginLogin(new Request("https://app.example.com/api/auth/login"));
    const destination = new URL(login.headers.get("location") ?? "");
    const state = destination.searchParams.get("state") ?? "";
    const callback = () => new Request(
      `https://app.example.com/api/auth/callback/cognito?code=valid-code&state=${state}`,
      { headers: { cookie: cookieHeader(login) } },
    );

    const first = await service.completeCallback(callback());
    const repeated = await service.completeCallback(callback());

    expect(first.status).toBe(302);
    expect(repeated.status).toBe(302);
    expect(users.size).toBe(1);
    expect([...users.values()][0]).toMatchObject({ userId: "user-1" });
    expect(first.headers.getSetCookie().join(";")).toContain("__Host-gym_session=signed-id-token");
    expect(first.headers.getSetCookie().join(";")).toContain("Max-Age=0");
    expect(first.headers.get("location")).toBe("https://app.example.com/onboarding");
  });

  it("requires a verified session and derives profile ownership from Cognito", async () => {
    const { service, userPort } = setup();
    await expect(service.getOnboardingProfile(new Request("https://app.example.com/api/v1/onboarding")))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });

    await userPort.createPending({ ...identity, createdAt: "2026-08-08T12:00:00.000Z", userId: "owned-user" });
    const request = new Request("https://app.example.com/api/v1/onboarding", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });
    await expect(service.getOnboardingProfile(request)).resolves.toMatchObject({
      displayName: "María Núñez",
      status: "PENDING",
      version: 1,
    });
  });

  it("completes only the session owner and keeps the account PENDING", async () => {
    const { service, userPort } = setup();
    await userPort.createPending({ ...identity, createdAt: "2026-08-08T12:00:00.000Z", userId: "owned-user" });
    const request = new Request("https://app.example.com/api/v1/onboarding", {
      headers: {
        cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
        origin: config.appBaseUrl,
      },
      method: "PATCH",
    });
    await expect(service.completeProfile(request, {
      displayName: "María Núñez",
      expectedVersion: 1,
      phone: "+595981123456",
    })).resolves.toMatchObject({ completed: true, status: "PENDING", version: 2 });
    expect(userPort.completePendingProfile).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owned-user",
    }));
  });

  it.each(["ACTIVE", "SUSPENDED", "REJECTED", "INACTIVE"] as const)(
    "rejects profile completion for a %s account",
    async (status) => {
      const { completed, service, userPort } = setup();
      const stored = { ...identity, createdAt: "2026-08-08T12:00:00.000Z", userId: "owned-user" };
      await userPort.createPending(stored);
      completed.set(stored.userId, {
        createdAt: stored.createdAt,
        displayName: stored.displayName,
        email: stored.email,
        emailVerified: true,
        id: stored.userId,
        roles: ["STUDENT"],
        status,
        updatedAt: stored.createdAt,
        version: 1,
      });
      const request = new Request("https://app.example.com/api/v1/onboarding", {
        headers: {
          cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
          origin: config.appBaseUrl,
        },
        method: "PATCH",
      });
      await expect(service.completeProfile(request, {
        displayName: "María Núñez",
        expectedVersion: 1,
        phone: "+595981123456",
      })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    },
  );

  it("rejects cross-origin completion and clears the session during logout", async () => {
    const { service } = setup();
    await expect(service.completeProfile(new Request("https://app.example.com/api/v1/onboarding", {
      headers: { origin: "https://attacker.example" },
      method: "PATCH",
    }), { displayName: "María Núñez", expectedVersion: 1, phone: "+595981123456" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const response = service.logout(new Request("https://app.example.com/api/auth/logout", {
      headers: { origin: config.appBaseUrl },
      method: "POST",
    }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/logout?");
    expect(response.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  });
});

describe("onboarding validation", () => {
  it("normalizes a Paraguayan phone and rejects protected client fields", () => {
    expect(validateCompleteProfile({
      displayName: "  María   Núñez ",
      expectedVersion: 1,
      phone: "0981 123-456",
    })).toEqual({
      data: { displayName: "María Núñez", expectedVersion: 1, phone: "+595981123456" },
      success: true,
    });
    expect(validateCompleteProfile({
      displayName: "María Núñez",
      expectedVersion: 1,
      phone: "+595981123456",
      role: "ADMIN",
      userId: "another-user",
    })).toMatchObject({ success: false });
  });
});

describe("Cognito ID token verification", () => {
  it("checks signature, issuer, audience, token use, nonce and verified email", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const verifier = new CognitoTokenClient(
      config,
      createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", kid: "key-1", use: "sig" }] }),
    );
    const token = await new SignJWT({
      email: "maria@example.com",
      email_verified: true,
      given_name: "María",
      nonce: "expected-nonce",
      token_use: "id",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("subject-001")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifier.verifyIdToken(token, "expected-nonce")).resolves.toMatchObject({
      cognitoSub: "subject-001",
      emailVerified: true,
    });
    await expect(verifier.verifyIdToken(token, "other-nonce")).rejects.toThrow("claims");
    await expect(verifier.verifySessionToken(token)).resolves.toMatchObject({
      cognitoSub: "subject-001",
    });
  });

  it("rejects an expired session token", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const verifier = new CognitoTokenClient(
      config,
      createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", kid: "key-2", use: "sig" }] }),
    );
    const token = await new SignJWT({
      email: "maria@example.com",
      email_verified: true,
      token_use: "id",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-2" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("subject-001")
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 10)
      .sign(privateKey);
    await expect(verifier.verifySessionToken(token)).rejects.toThrow();
  });
});
