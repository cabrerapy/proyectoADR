import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type { CreatePendingUserResult } from "@gym-adr/data-access";
import type { UserProfile } from "@gym-adr/domain";
import {
  validateAdminStudentQuery,
  validateCompleteProfile,
  validateTransitionStudentStatus,
  validateUpdateOwnProfile,
} from "@gym-adr/validation";
import { describe, expect, it, vi } from "vitest";

import { resolveAuthConfig, type AuthConfig } from "./auth-config";
import { AuthService, type PendingUserPort } from "./auth-service";
import { CognitoTokenClient, type CognitoTokenPort } from "./cognito-client";
import { oauthCookieNames, sessionCookieName } from "./cookies";
import { FixedWindowRateLimiter } from "./rate-limiter";
import type { RateLimiter } from "./rate-limiter";

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

  const setup = (
    rateLimiter: RateLimiter = new FixedWindowRateLimiter(() => 1),
  ) => {
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
      findByEmail: vi.fn(async (email) => {
        const stored = [...users.values()].find((entry) => entry.email === email);
        return stored === undefined ? undefined : toProfile(stored);
      }),
      findByCognitoSub: vi.fn(async (sub) => {
        const stored = users.get(sub);
        return stored === undefined ? undefined : toProfile(stored);
      }),
      getById: vi.fn(async (userId) => {
        const stored = [...users.values()].find((entry) => entry.userId === userId);
        return stored === undefined ? undefined : toProfile(stored);
      }),
      listByStatus: vi.fn(async (status) => ({
        profiles: [...users.values()].map(toProfile).filter((profile) => profile.status === status),
      })),
      searchByName: vi.fn(async (prefix) => ({
        profiles: [...users.values()].map(toProfile).filter((profile) =>
          profile.displayName.toLocaleLowerCase("es").startsWith(prefix.toLocaleLowerCase("es"))
        ),
      })),
      transitionStatus: vi.fn(async (input) => {
        const stored = [...users.values()].find((entry) => entry.userId === input.userId);
        if (stored === undefined) throw new Error("missing test user");
        const profile: UserProfile = {
          ...toProfile(stored),
          status: input.status,
          updatedAt: input.transitionedAt,
          version: input.expectedVersion + 1,
        };
        completed.set(input.userId, profile);
        return profile;
      }),
      updateOwn: vi.fn(async (input) => {
        const stored = [...users.values()].find((entry) => entry.userId === input.userId);
        if (stored === undefined) throw new Error("missing test user");
        const profile: UserProfile = {
          ...toProfile(stored),
          displayName: input.displayName,
          emailNotificationsEnabled: input.emailNotificationsEnabled,
          phone: input.phone,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        };
        completed.set(input.userId, profile);
        return profile;
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
      rateLimiter,
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

  it("rate limits onboarding by the authenticated principal without exposing its ID", async () => {
    const keys: string[] = [];
    const rateLimiter: RateLimiter = {
      consume: (key) => {
        keys.push(key);
        return !key.startsWith("onboarding-write:");
      },
    };
    const { service, userPort } = setup(rateLimiter);
    await userPort.createPending({
      ...identity,
      createdAt: "2026-08-08T12:00:00.000Z",
      userId: "owned-user",
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
    })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(userPort.completePendingProfile).not.toHaveBeenCalled();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^onboarding-write:[a-f0-9]{64}$/u);
    expect(keys[0]).not.toContain("owned-user");
  });

  it.each(["STUDENT", "STAFF", "ADMIN"] as const)(
    "reads and updates only the authenticated %s profile",
    async (role) => {
      const { completed, service, userPort } = setup();
      const stored = {
        ...identity,
        createdAt: "2026-08-08T12:00:00.000Z",
        userId: "owned-user",
      };
      await userPort.createPending(stored);
      completed.set(stored.userId, {
        createdAt: stored.createdAt,
        displayName: stored.displayName,
        email: stored.email,
        emailVerified: true,
        id: stored.userId,
        onboardingCompletedAt: "2026-08-08T12:10:00.000Z",
        phone: "+595981123456",
        roles: [role],
        status: "ACTIVE",
        updatedAt: "2026-08-08T12:10:00.000Z",
        version: 2,
      });
      const readRequest = new Request("https://app.example.com/api/v1/me/profile", {
        headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
      });
      await expect(service.getOwnProfile(readRequest)).resolves.toMatchObject({
        email: stored.email,
        roles: [role],
        status: "ACTIVE",
      });
      const updateRequest = new Request("https://app.example.com/api/v1/me/profile", {
        headers: {
          cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
          origin: config.appBaseUrl,
        },
        method: "PATCH",
      });
      await expect(service.updateOwnProfile(updateRequest, {
        displayName: "María Benítez",
        emailNotificationsEnabled: false,
        expectedVersion: 2,
        phone: "+595981999999",
      })).resolves.toMatchObject({
        displayName: "María Benítez",
        emailNotificationsEnabled: false,
        roles: [role],
        status: "ACTIVE",
        version: 3,
      });
      expect(userPort.updateOwn).toHaveBeenCalledWith(expect.objectContaining({
        userId: "owned-user",
      }));
    },
  );

  it.each(["PENDING", "SUSPENDED", "INACTIVE"] as const)(
    "allows the approved own-profile fields for a %s account",
    async (status) => {
      const { completed, service, userPort } = setup();
      const stored = {
        ...identity,
        createdAt: "2026-08-08T12:00:00.000Z",
        userId: "owned-user",
      };
      await userPort.createPending(stored);
      completed.set(stored.userId, {
        createdAt: stored.createdAt,
        displayName: stored.displayName,
        email: stored.email,
        emailVerified: true,
        id: stored.userId,
        onboardingCompletedAt: "2026-08-08T12:10:00.000Z",
        phone: "+595981123456",
        roles: ["STUDENT"],
        status,
        updatedAt: "2026-08-08T12:10:00.000Z",
        version: 2,
      });
      const request = new Request("https://app.example.com/api/v1/me/profile", {
        headers: {
          cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
          origin: config.appBaseUrl,
        },
        method: "PATCH",
      });
      await expect(service.updateOwnProfile(request, {
        displayName: "María Benítez",
        emailNotificationsEnabled: true,
        expectedVersion: 2,
        phone: "+595981999999",
      })).resolves.toMatchObject({ status });
    },
  );

  it("denies own-profile access without a session and updates for rejected accounts", async () => {
    const { completed, service, userPort } = setup();
    await expect(service.getOwnProfile(new Request("https://app.example.com/api/v1/me/profile")))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });

    const stored = {
      ...identity,
      createdAt: "2026-08-08T12:00:00.000Z",
      userId: "owned-user",
    };
    await userPort.createPending(stored);
    completed.set(stored.userId, {
      createdAt: stored.createdAt,
      displayName: stored.displayName,
      email: stored.email,
      emailVerified: true,
      id: stored.userId,
      onboardingCompletedAt: "2026-08-08T12:10:00.000Z",
      phone: "+595981123456",
      roles: ["ADMIN"],
      status: "REJECTED",
      updatedAt: "2026-08-08T12:10:00.000Z",
      version: 2,
    });
    const request = new Request("https://app.example.com/api/v1/me/profile", {
      headers: {
        cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
        origin: config.appBaseUrl,
      },
      method: "PATCH",
    });
    await expect(service.updateOwnProfile(request, {
      displayName: "Nombre rechazado",
      emailNotificationsEnabled: false,
      expectedVersion: 2,
      phone: "+595981999999",
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(userPort.updateOwn).not.toHaveBeenCalled();
  });

  it("lists pending students for ADMIN and returns full fields", async () => {
    const { completed, service, userPort } = setup();
    const admin = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-1" };
    await userPort.createPending(admin);
    completed.set(admin.userId, {
      createdAt: admin.createdAt,
      displayName: "Administradora",
      email: admin.email,
      emailVerified: true,
      id: admin.userId,
      roles: ["ADMIN"],
      status: "ACTIVE",
      updatedAt: admin.createdAt,
      version: 2,
    });
    await userPort.createPending({
      cognitoSub: "student-subject",
      createdAt: "2026-08-08T12:05:00Z",
      displayName: "Ana López",
      email: "ana@example.com",
      emailVerified: true,
      userId: "student-1",
    });
    const request = new Request("https://app.example.com/api/v1/admin/students", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });

    await expect(service.listAdminStudents(request, { filter: "pending" })).resolves.toMatchObject({
      capabilities: { canManageStatus: true, canReadFull: true },
      students: [expect.objectContaining({ email: "ana@example.com", id: "student-1" })],
    });
    expect(userPort.listByStatus).toHaveBeenCalledWith("PENDING", {});
    await service.listAdminStudents(request, { filter: "name", value: "Ana" });
    expect(userPort.searchByName).toHaveBeenCalledWith("Ana", {});
    await service.listAdminStudents(request, { filter: "email", value: "ana@example.com" });
    expect(userPort.findByEmail).toHaveBeenCalledWith("ana@example.com");
    await expect(service.listAdminStudents(request, {
      cursor: Buffer.from(JSON.stringify({ cursors: {}, query: "status:ACTIVE" })).toString("base64url"),
      filter: "pending",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("limits STAFF to operational listings and denies email search", async () => {
    const { completed, service, userPort } = setup();
    const staff = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "staff-1" };
    await userPort.createPending(staff);
    completed.set(staff.userId, {
      createdAt: staff.createdAt,
      displayName: "Personal",
      email: staff.email,
      emailVerified: true,
      id: staff.userId,
      roles: ["STAFF"],
      status: "ACTIVE",
      updatedAt: staff.createdAt,
      version: 2,
    });
    await userPort.createPending({
      cognitoSub: "student-subject",
      createdAt: "2026-08-08T12:05:00Z",
      displayName: "Ana López",
      email: "ana@example.com",
      emailVerified: true,
      userId: "student-1",
    });
    const request = new Request("https://app.example.com/api/v1/admin/students", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });

    const page = await service.listAdminStudents(request, { filter: "pending" });
    expect(page).toMatchObject({ capabilities: { canManageStatus: false, canReadFull: false } });
    expect(page.students[0]).not.toHaveProperty("email");
    await expect(service.listAdminStudents(request, { filter: "email", value: "ana@example.com" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(userPort.findByEmail).not.toHaveBeenCalled();
  });

  it.each([
    { roles: ["STUDENT"] as const, status: "ACTIVE" as const },
    { roles: ["ADMIN"] as const, status: "PENDING" as const },
    { roles: ["ADMIN"] as const, status: "SUSPENDED" as const },
    { roles: ["ADMIN"] as const, status: "REJECTED" as const },
    { roles: ["ADMIN"] as const, status: "INACTIVE" as const },
  ])("denies administrative listing for $roles/$status", async ({ roles, status }) => {
    const { completed, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "actor-1" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt,
      displayName: "Actor",
      email: actor.email,
      emailVerified: true,
      id: actor.userId,
      roles,
      status,
      updatedAt: actor.createdAt,
      version: 2,
    });
    const request = new Request("https://app.example.com/api/v1/admin/students", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });
    await expect(service.listAdminStudents(request, { filter: "pending" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(userPort.listByStatus).not.toHaveBeenCalled();
  });

  it("authorizes and audits an ADMIN transition without trusting actor fields", async () => {
    const { completed, service, userPort } = setup();
    const admin = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-1" };
    await userPort.createPending(admin);
    completed.set(admin.userId, {
      createdAt: admin.createdAt,
      displayName: "Administradora",
      email: admin.email,
      emailVerified: true,
      id: admin.userId,
      roles: ["ADMIN"],
      status: "ACTIVE",
      updatedAt: admin.createdAt,
      version: 2,
    });
    const student = {
      cognitoSub: "student-subject",
      createdAt: "2026-08-08T12:05:00Z",
      displayName: "Ana López",
      email: "ana@example.com",
      emailVerified: true,
      userId: "student-1",
    };
    await userPort.createPending(student);
    const request = new Request("https://app.example.com/api/v1/admin/students/student-1", {
      headers: {
        cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
        origin: config.appBaseUrl,
      },
      method: "PATCH",
    });

    await expect(service.transitionAdminStudent(request, "correlation-1", student.userId, {
      expectedVersion: 1,
      status: "ACTIVE",
    })).resolves.toMatchObject({ id: student.userId, status: "ACTIVE", version: 2 });
    expect(userPort.transitionStatus).toHaveBeenCalledWith(expect.objectContaining({
      actorId: admin.userId,
      correlationId: "correlation-1",
      userId: student.userId,
    }));
  });

  it("denies unauthenticated, horizontal and self-directed administrative mutations before writing", async () => {
    const { completed, service, userPort } = setup();
    const requestWithoutSession = new Request("https://app.example.com/api/v1/admin/students/student-1", {
      headers: { origin: config.appBaseUrl },
      method: "PATCH",
    });
    await expect(service.transitionAdminStudent(requestWithoutSession, "correlation-1", "student-1", {
      expectedVersion: 1,
      status: "ACTIVE",
    })).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });

    const studentActor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "student-actor" };
    await userPort.createPending(studentActor);
    completed.set(studentActor.userId, {
      createdAt: studentActor.createdAt,
      displayName: studentActor.displayName,
      email: studentActor.email,
      emailVerified: true,
      id: studentActor.userId,
      roles: ["STUDENT"],
      status: "ACTIVE",
      updatedAt: studentActor.createdAt,
      version: 2,
    });
    const studentRequest = new Request("https://app.example.com/api/v1/admin/students/other-student", {
      headers: {
        cookie: `${sessionCookieName(config.environment)}=signed-id-token`,
        origin: config.appBaseUrl,
      },
      method: "PATCH",
    });
    await expect(service.transitionAdminStudent(studentRequest, "correlation-2", "other-student", {
      expectedVersion: 1,
      status: "ACTIVE",
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(userPort.getById).not.toHaveBeenCalledWith("other-student", true);
    expect(userPort.transitionStatus).not.toHaveBeenCalled();

    completed.set(studentActor.userId, {
      ...(completed.get(studentActor.userId) as UserProfile),
      roles: ["ADMIN", "STUDENT"],
    });
    await expect(service.transitionAdminStudent(studentRequest, "correlation-3", studentActor.userId, {
      expectedVersion: 2,
      reason: "Intento no permitido",
      status: "INACTIVE",
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(userPort.transitionStatus).not.toHaveBeenCalled();
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

  it("accepts only own editable fields and rejects horizontal or protected fields", () => {
    expect(validateUpdateOwnProfile({
      displayName: "  María   Benítez ",
      emailNotificationsEnabled: false,
      expectedVersion: 2,
      phone: "0981 999-999",
    })).toEqual({
      data: {
        displayName: "María Benítez",
        emailNotificationsEnabled: false,
        expectedVersion: 2,
        phone: "+595981999999",
      },
      success: true,
    });
    for (const protectedField of ["userId", "roles", "status", "email", "joinedAt"]) {
      expect(validateUpdateOwnProfile({
        displayName: "María Benítez",
        emailNotificationsEnabled: true,
        expectedVersion: 2,
        phone: "+595981999999",
        [protectedField]: protectedField === "userId" ? "another-user" : "forbidden",
      })).toMatchObject({ success: false });
    }
  });

  it("validates administrative filters and status transitions exactly", () => {
    expect(validateAdminStudentQuery(new URLSearchParams("filter=status&value=PENDING")))
      .toEqual({ data: { filter: "status", value: "PENDING" }, success: true });
    expect(validateAdminStudentQuery(new URLSearchParams("filter=name&value=An")))
      .toMatchObject({ success: false });
    expect(validateAdminStudentQuery(new URLSearchParams("filter=pending&userId=other")))
      .toMatchObject({ success: false });
    expect(validateTransitionStudentStatus({
      expectedVersion: 2,
      reason: "  Cuota administrativa pendiente ",
      status: "SUSPENDED",
    })).toEqual({
      data: {
        expectedVersion: 2,
        reason: "Cuota administrativa pendiente",
        status: "SUSPENDED",
      },
      success: true,
    });
    expect(validateTransitionStudentStatus({ expectedVersion: 2, status: "REJECTED" }))
      .toMatchObject({ success: false });
    expect(validateTransitionStudentStatus({
      actorId: "attacker",
      expectedVersion: 2,
      status: "ACTIVE",
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
