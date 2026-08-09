import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type { CreatePendingUserResult } from "@gym-adr/data-access";
import { describe, expect, it, vi } from "vitest";

import { resolveAuthConfig, type AuthConfig } from "./auth-config";
import { AuthService, type PendingUserPort } from "./auth-service";
import { CognitoTokenClient, type CognitoTokenPort } from "./cognito-client";
import { oauthCookieNames } from "./cookies";
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
    const userPort: PendingUserPort = {
      createPending: vi.fn(async (input) => {
        const existing = users.get(input.cognitoSub);
        users.set(input.cognitoSub, existing ?? input);
        const stored = existing ?? input;
        const result: CreatePendingUserResult = {
          disposition: existing === undefined ? "CREATED" : "EXISTING",
          profile: {
            createdAt: stored.createdAt,
            displayName: stored.displayName,
            email: stored.email,
            emailVerified: true,
            id: stored.userId,
            roles: ["STUDENT"],
            status: "PENDING",
            updatedAt: stored.createdAt,
            version: 1,
          },
        };
        return result;
      }),
    };
    const tokens: CognitoTokenPort = {
      exchangeCode: vi.fn(async () => "signed-id-token"),
      verifyIdToken: vi.fn(async () => identity),
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
    return { service, tokens, userPort, users };
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
  });
});
