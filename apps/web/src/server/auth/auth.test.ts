import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type { CreatePendingUserResult } from "@gym-adr/data-access";
import type { ClassSession, ClassType, GalleryAsset, Membership, MembershipPlan, Payment, Reservation, Trainer, UserProfile } from "@gym-adr/domain";
import {
  validateAdminStudentQuery,
  validateCompleteProfile,
  validateCreateMembershipPlan,
  validateMembershipPlanQuery,
  validateMembershipReportQuery,
  validateOwnMembershipQuery,
  validateTransitionStudentStatus,
  validateUpdateMembershipPlan,
  validateUpdateOwnProfile,
} from "@gym-adr/validation";
import { describe, expect, it, vi } from "vitest";

import { resolveAuthConfig, type AuthConfig } from "./auth-config";
import { AuthService, type BookingPort, type ClassSessionPort, type GalleryPort, type GymSettingsPort, type MembershipPlanPort, type MembershipPort, type PaymentPort, type PendingUserPort, type ReservationPort, type SchedulingCatalogPort } from "./auth-service";
import { CognitoTokenClient, type CognitoTokenPort } from "./cognito-client";
import { oauthCookieNames, sessionCookieName } from "./cookies";
import { FixedWindowRateLimiter } from "./rate-limiter";
import type { RateLimiter } from "./rate-limiter";
import type { ReceiptUploadPort } from "../payments/receipt-upload";
import type { GalleryUploadSignerPort } from "../gallery/gallery-upload";

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
    const plans = new Map<string, MembershipPlan>();
    const planPort: MembershipPlanPort = {
      create: vi.fn(async (input) => {
        const plan: MembershipPlan = {
          createdAt: input.createdAt,
          createdBy: input.actorId,
          currency: input.currency,
          ...(input.description === undefined ? {} : { description: input.description }),
          frequency: input.frequency,
          id: input.planId,
          name: input.name,
          price: input.price,
          status: "ACTIVE",
          updatedAt: input.createdAt,
          updatedBy: input.actorId,
          version: 1,
        };
        plans.set(plan.id, plan);
        return plan;
      }),
      getById: vi.fn(async (planId) => plans.get(planId)),
      list: vi.fn(async (status = "ALL") => ({
        plans: [...plans.values()].filter((plan) => status === "ALL" || plan.status === status),
      })),
      update: vi.fn(async (input) => {
        const current = plans.get(input.planId);
        if (current === undefined) throw new Error("missing test plan");
        const plan: MembershipPlan = {
          ...current,
          currency: input.currency,
          ...(input.description === undefined ? {} : { description: input.description }),
          frequency: input.frequency,
          name: input.name,
          price: input.price,
          status: input.status,
          updatedAt: input.updatedAt,
          updatedBy: input.actorId,
          version: input.expectedVersion + 1,
        };
        plans.set(plan.id, plan);
        return plan;
      }),
    };
    const memberships = new Map<string, Membership>();
    const membershipPort: MembershipPort = {
      create: vi.fn(async (input) => {
        const membership: Membership = {
          createdAt: input.createdAt,
          createdBy: input.createdBy,
          currency: input.currency,
          endDate: input.endDate,
          expectedAmount: input.expectedAmount,
          frequency: input.frequency,
          id: input.membershipId,
          planId: input.planId,
          planName: input.planName,
          startDate: input.startDate,
          status: input.status,
          updatedAt: input.createdAt,
          userId: input.userId,
          version: 1,
        };
        memberships.set(membership.id, membership);
        return membership;
      }),
      getById: vi.fn(async (userId, startDate, membershipId) => {
        const membership = memberships.get(membershipId);
        return membership !== undefined && membership.userId === userId && membership.startDate === startDate
          ? membership
          : undefined;
      }),
      getActive: vi.fn(async (userId) => [...memberships.values()].find(
        (membership) => membership.userId === userId && membership.status === "ACTIVE",
      )),
      listByStatus: vi.fn(async (status) => ({
        memberships: [...memberships.values()].filter((membership) => membership.status === status),
      })),
      listDue: vi.fn(async (dueDate) => ({
        memberships: [...memberships.values()].filter((membership) => membership.endDate === dueDate),
      })),
      listHistory: vi.fn(async (userId) => ({
        memberships: [...memberships.values()].filter((membership) => membership.userId === userId),
      })),
      update: vi.fn(async (input) => {
        const current = memberships.get(input.membershipId);
        if (current === undefined) throw new Error("missing test membership");
        const membership: Membership = {
          ...current,
          endDate: input.endDate,
          expectedAmount: input.expectedAmount,
          status: input.status,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        };
        memberships.set(membership.id, membership);
        return membership;
      }),
    };
    const paymentRecords: Payment[] = [];
    const paymentPort: PaymentPort = {
      getById: vi.fn(async (userId, paidAt, paymentId) => paymentRecords.find((payment) => payment.userId === userId && payment.paidAt === paidAt && payment.id === paymentId)),
      listByDate: vi.fn(async (date) => ({ payments: paymentRecords.filter((payment) => payment.paymentDate === date) })),
      listByStatus: vi.fn(async (status) => ({ payments: paymentRecords.filter((payment) => payment.status === status) })),
      listHistory: vi.fn(async (userId) => ({ payments: paymentRecords.filter((payment) => payment.userId === userId) })),
      record: vi.fn(async (input) => ({
        disposition: "CREATED" as const,
        value: {
          amount: input.amount, createdAt: input.createdAt, currency: input.currency,
          id: input.paymentId, membershipId: input.membershipId, method: input.method,
          ...(input.notes === undefined ? {} : { notes: input.notes }), paidAt: input.paidAt,
          paymentDate: input.paymentDate, periodEnd: input.periodEnd, periodStart: input.periodStart,
          ...(input.receiptKey === undefined ? {} : { receiptKey: input.receiptKey }),
          recordedBy: input.recordedBy, status: input.status, updatedAt: input.createdAt,
          userId: input.userId, version: 1,
        } satisfies Payment,
      })),
      voidConfirmed: vi.fn(async (input) => ({
        disposition: "CREATED" as const,
        value: { actorId: input.actorId, correctedAt: input.correctedAt, id: input.correctionId, originalPaymentId: input.paymentId, reason: input.reason, type: "VOID" as const, userId: input.userId },
      })),
    };
    const receiptPort: ReceiptUploadPort = {
      issue: vi.fn(async () => ({ headers: { "content-type": "application/pdf" }, key: "payment-receipts/test.pdf", uploadUrl: "/signed-upload" })),
      issueDownload: vi.fn(async () => "/signed-download"),
    };
    const galleryPort: GalleryPort = {
      createUpload: vi.fn(async (input) => ({
        asset: {
          createdAt: input.createdAt,
          createdBy: input.createdBy,
          id: input.assetId,
          originalObjectKey: input.originalObjectKey,
          status: "UPLOADING",
          updatedAt: input.createdAt,
          version: 1,
        } satisfies GalleryAsset,
        disposition: "CREATED" as const,
      })),
    };
    const galleryUploadPort: GalleryUploadSignerPort = {
      issue: vi.fn(async (assetId, key, input) => ({
        headers: { "content-type": input.contentType, "x-amz-meta-assetid": assetId },
        key,
        uploadUrl: "/signed-gallery-upload",
      })),
    };
    const catalogPort: SchedulingCatalogPort = {
      createClassType: vi.fn(async (input) => ({ createdAt: input.createdAt, createdBy: input.actorId, ...(input.description === undefined ? {} : { description: input.description }), id: input.id, name: input.name, status: "ACTIVE", updatedAt: input.createdAt, updatedBy: input.actorId, version: 1 } satisfies ClassType)),
      createTrainer: vi.fn(async (input) => ({ createdAt: input.createdAt, createdBy: input.actorId, ...(input.description === undefined ? {} : { bio: input.description }), id: input.id, name: input.name, status: "ACTIVE", updatedAt: input.createdAt, updatedBy: input.actorId, version: 1 } satisfies Trainer)),
      getClassType: vi.fn(async (id) => ({ createdAt: "2026-08-08T10:00:00Z", createdBy: "admin", id, name: "Cross training", status: "ACTIVE", updatedAt: "2026-08-08T10:00:00Z", updatedBy: "admin", version: 1 } satisfies ClassType)),
      getTrainer: vi.fn(async (id) => ({ createdAt: "2026-08-08T10:00:00Z", createdBy: "admin", id, name: "Entrenador", status: "ACTIVE", updatedAt: "2026-08-08T10:00:00Z", updatedBy: "admin", version: 1 } satisfies Trainer)),
      listClassTypes: vi.fn(async () => ({ items: [] })),
      listTrainers: vi.fn(async () => ({ items: [] })),
      updateClassType: vi.fn(async (input) => ({ createdAt: "2026-08-08T10:00:00Z", createdBy: "admin", ...(input.description === undefined ? {} : { description: input.description }), id: input.id, name: input.name, status: input.status, updatedAt: input.updatedAt, updatedBy: input.actorId, version: input.expectedVersion + 1 } satisfies ClassType)),
      updateTrainer: vi.fn(async (input) => ({ createdAt: "2026-08-08T10:00:00Z", createdBy: "admin", ...(input.description === undefined ? {} : { bio: input.description }), id: input.id, name: input.name, status: input.status, updatedAt: input.updatedAt, updatedBy: input.actorId, version: input.expectedVersion + 1 } satisfies Trainer)),
    };
    const classSessionRecords: ClassSession[] = [];
    const classSessionPort: ClassSessionPort = {
      cancel: vi.fn(async (input) => { const current = classSessionRecords.find((entry) => entry.id === input.classId); if (current === undefined) throw new Error("missing class"); const value: ClassSession = { ...current, status: "CANCELLED", updatedAt: input.updatedAt, version: input.expectedVersion + 1 }; classSessionRecords.splice(classSessionRecords.indexOf(current), 1, value); return value; }),
      create: vi.fn(async (input) => { const value: ClassSession = { capacity: input.capacity, classDate: input.classDate, classTypeId: input.classTypeId, classTypeName: input.classTypeName, confirmedCount: 0, createdAt: input.createdAt, createdBy: input.createdBy, endsAt: input.endsAt, id: input.classId, startTime: input.startTime, startsAt: input.startsAt, status: "SCHEDULED", trainerId: input.trainerId, trainerName: input.trainerName, updatedAt: input.createdAt, version: 1 }; classSessionRecords.push(value); return value; }),
      getById: vi.fn(async (id) => classSessionRecords.find((entry) => entry.id === id)),
      listByDate: vi.fn(async (date) => ({ sessions: classSessionRecords.filter((entry) => entry.classDate === date) })),
      listAvailable: vi.fn(async (from, to) => ({ sessions: classSessionRecords.filter((entry) => entry.classDate >= from && entry.classDate <= to && entry.status === "SCHEDULED" && entry.confirmedCount < entry.capacity) })),
      propagateCancellationBatch: vi.fn(async (input) => { const current = classSessionRecords.find((entry) => entry.id === input.classId); if (current === undefined) throw new Error("missing class"); return { cancelledCount: 0, complete: true, session: current }; }),
      update: vi.fn(async (input) => { const current = classSessionRecords.find((entry) => entry.id === input.classId); if (current === undefined) throw new Error("missing class"); const value: ClassSession = { ...current, capacity: input.capacity, classDate: input.classDate, classTypeId: input.classTypeId, classTypeName: input.classTypeName, endsAt: input.endsAt, startTime: input.startTime, startsAt: input.startsAt, trainerId: input.trainerId, trainerName: input.trainerName, updatedAt: input.updatedAt, version: input.expectedVersion + 1 }; classSessionRecords.splice(classSessionRecords.indexOf(current), 1, value); return value; }),
    };
    const bookingPort: BookingPort = {
      cancel: vi.fn(async (input) => ({
        disposition: "CREATED" as const,
        reservation: {
          classId: input.classId,
          createdAt: "2026-08-08T10:00:00Z",
          id: "reservation-001",
          startsAt: "2026-08-10T22:00:00.000Z",
          status: "CANCELLED",
          studentId: input.studentId,
          updatedAt: input.cancelledAt,
          version: 2,
        } satisfies Reservation,
      })),
      reserve: vi.fn(async (input) => ({
        disposition: "CREATED" as const,
        reservation: {
          classId: input.classId,
          createdAt: input.createdAt,
          id: input.reservationId,
          startsAt: "2026-08-10T22:00:00.000Z",
          status: "CONFIRMED",
          studentId: input.studentId,
          updatedAt: input.createdAt,
          version: 1,
        } satisfies Reservation,
      })),
    };
    const reservationRecords: Reservation[] = [];
    const reservationPort: ReservationPort = {
      listByStudent: vi.fn(async (studentId) => ({ reservations: reservationRecords.filter((entry) => entry.studentId === studentId) })),
    };
    const settingsPort: GymSettingsPort = {
      get: vi.fn(async () => ({ cancellationWindowMinutes: 120, currency: "PYG", gymName: "Gym ADR", timezone: "America/Asuncion", updatedAt: "2026-08-08T10:00:00Z", updatedBy: "admin", version: 1 })),
    };
    let sequence = 0;
    const service = new AuthService({
      bookings: bookingPort,
      clock: () => new Date("2026-08-08T12:00:00Z"),
      catalog: catalogPort,
      classSessions: classSessionPort,
      config,
      gallery: galleryPort,
      galleryUploads: galleryUploadPort,
      ids: () => `user-${++sequence}`,
      memberships: membershipPort,
      payments: paymentPort,
      plans: planPort,
      rateLimiter,
      receipts: receiptPort,
      reservations: reservationPort,
      settings: settingsPort,
      tokens,
      users: userPort,
    });
    return { bookingPort, catalogPort, classSessionPort, classSessionRecords, completed, galleryPort, galleryUploadPort, membershipPort, memberships, paymentPort, paymentRecords, planPort, plans, receiptPort, reservationPort, reservationRecords, service, settingsPort, tokens, userPort, users };
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

  it("lets an active ADMIN create, edit and logically deactivate an audited plan", async () => {
    const { completed, planPort, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-1" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt,
      displayName: "Administradora",
      email: actor.email,
      emailVerified: true,
      id: actor.userId,
      roles: ["ADMIN"],
      status: "ACTIVE",
      updatedAt: actor.createdAt,
      version: 2,
    });
    const request = new Request("https://app.example.com/api/v1/admin/plans", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl },
      method: "POST",
    });
    const created = await service.createAdminMembershipPlan(request, "correlation-1", {
      currency: "PYG",
      description: "Acceso mensual",
      frequency: "MONTHLY",
      name: "Plan mensual",
      price: 250_000,
    });
    expect(planPort.create).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.userId }));
    await expect(service.listAdminMembershipPlans(request, { status: "ACTIVE" }))
      .resolves.toMatchObject({ capabilities: { canManage: true }, plans: [{ id: created.id }] });
    await expect(service.updateAdminMembershipPlan(request, "correlation-2", created.id, {
      currency: "PYG",
      frequency: "MONTHLY",
      name: "Plan mensual actualizado",
      price: 275_000,
      expectedVersion: 1,
      status: "INACTIVE",
    })).resolves.toMatchObject({ status: "INACTIVE", version: 2 });
    expect(planPort.update).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.userId, planId: created.id }));
  });

  it("allows active STAFF to read plans but denies mutations and denies inactive ADMIN", async () => {
    for (const scenario of [
      { canRead: true, roles: ["STAFF"] as const, status: "ACTIVE" as const },
      { canRead: false, roles: ["STUDENT"] as const, status: "ACTIVE" as const },
      { canRead: false, roles: ["ADMIN"] as const, status: "PENDING" as const },
      { canRead: false, roles: ["ADMIN"] as const, status: "SUSPENDED" as const },
      { canRead: false, roles: ["ADMIN"] as const, status: "INACTIVE" as const },
    ]) {
      const { completed, planPort, service, userPort } = setup();
      const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: `actor-${scenario.status}-${scenario.roles[0]}` };
      await userPort.createPending(actor);
      completed.set(actor.userId, {
        createdAt: actor.createdAt,
        displayName: "Actor",
        email: actor.email,
        emailVerified: true,
        id: actor.userId,
        roles: scenario.roles,
        status: scenario.status,
        updatedAt: actor.createdAt,
        version: 2,
      });
      const request = new Request("https://app.example.com/api/v1/admin/plans", {
        headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl },
        method: "POST",
      });
      if (scenario.canRead) {
        await expect(service.listAdminMembershipPlans(request, { status: "ALL" }))
          .resolves.toMatchObject({ capabilities: { canManage: false } });
      } else {
        await expect(service.listAdminMembershipPlans(request, { status: "ALL" }))
          .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      }
      await expect(service.createAdminMembershipPlan(request, "correlation-1", {
        currency: "PYG", frequency: "MONTHLY", name: "No permitido", price: 1,
      })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(planPort.create).not.toHaveBeenCalled();
    }
    const { service } = setup();
    await expect(service.listAdminMembershipPlans(
      new Request("https://app.example.com/api/v1/admin/plans"),
      { status: "ALL" },
    )).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });
  });

  it("lets an active ADMIN create, activate and suspend an audited membership", async () => {
    const { completed, membershipPort, plans, service, userPort } = setup();
    plans.set("plan-1", {
      createdAt: "2026-08-08T10:00:00Z", createdBy: "admin-1", currency: "PYG",
      frequency: "MONTHLY", id: "plan-1", name: "Plan mensual", price: 250_000,
      status: "ACTIVE", updatedAt: "2026-08-08T10:00:00Z", updatedBy: "admin-1", version: 1,
    });
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-1" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt, displayName: "Administradora", email: actor.email,
      emailVerified: true, id: actor.userId, roles: ["ADMIN"], status: "ACTIVE",
      updatedAt: actor.createdAt, version: 2,
    });
    const request = new Request("https://app.example.com/api/v1/admin/memberships", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "POST",
    });
    const created = await service.createAdminMembership(request, "correlation-create", {
      endDate: "2026-09-08", expectedAmount: 250_000, planId: "plan-1",
      startDate: "2026-08-08", userId: "student-1",
    });
    expect(created).toMatchObject({ standing: "INACTIVE", status: "PENDING" });
    await expect(service.listAdminMemberships(request, { userId: "student-1" }))
      .resolves.toMatchObject({ capabilities: { canManageStates: true }, memberships: [{ id: created.id }] });
    const active = await service.updateAdminMembership(request, "correlation-active", created.id, {
      endDate: created.endDate, expectedAmount: created.expectedAmount, expectedVersion: 1,
      startDate: created.startDate, status: "ACTIVE", userId: created.userId,
    });
    expect(active).toMatchObject({ standing: "CURRENT", status: "ACTIVE", version: 2 });
    await expect(service.updateAdminMembership(request, "correlation-suspend", created.id, {
      endDate: active.endDate, expectedAmount: active.expectedAmount, expectedVersion: 2,
      reason: "Suspensión administrativa solicitada", startDate: active.startDate,
      status: "SUSPENDED", userId: active.userId,
    })).resolves.toMatchObject({ standing: "INACTIVE", status: "SUSPENDED", version: 3 });
    expect(membershipPort.update).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: actor.userId }));
  });

  it("allows STAFF operational edits but denies state changes and blocks unauthorized states", async () => {
    for (const scenario of [
      { allowed: true, roles: ["STAFF"] as const, status: "ACTIVE" as const },
      { allowed: false, roles: ["STUDENT"] as const, status: "ACTIVE" as const },
      { allowed: false, roles: ["ADMIN"] as const, status: "PENDING" as const },
      { allowed: false, roles: ["ADMIN"] as const, status: "SUSPENDED" as const },
      { allowed: false, roles: ["ADMIN"] as const, status: "INACTIVE" as const },
    ]) {
      const { completed, membershipPort, memberships, service, userPort } = setup();
      const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: `membership-${scenario.status}-${scenario.roles[0]}` };
      await userPort.createPending(actor);
      completed.set(actor.userId, {
        createdAt: actor.createdAt, displayName: "Actor", email: actor.email, emailVerified: true,
        id: actor.userId, roles: scenario.roles, status: scenario.status, updatedAt: actor.createdAt, version: 2,
      });
      const pending: Membership = {
        createdAt: actor.createdAt, createdBy: "admin", currency: "PYG", endDate: "2026-09-08",
        expectedAmount: 250_000, frequency: "MONTHLY", id: "membership-1", planId: "plan-1",
        planName: "Plan mensual", startDate: "2026-08-08", status: "PENDING",
        updatedAt: actor.createdAt, userId: "student-1", version: 1,
      };
      memberships.set(pending.id, pending);
      const request = new Request("https://app.example.com/api/v1/admin/memberships", {
        headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "PATCH",
      });
      if (scenario.allowed) {
        await expect(service.updateAdminMembership(request, "correlation-edit", pending.id, {
          endDate: "2026-09-10", expectedAmount: pending.expectedAmount, expectedVersion: 1,
          startDate: pending.startDate, status: "PENDING", userId: pending.userId,
        })).resolves.toMatchObject({ endDate: "2026-09-10" });
        await expect(service.updateAdminMembership(request, "correlation-state", pending.id, {
          endDate: pending.endDate, expectedAmount: pending.expectedAmount, expectedVersion: 1,
          startDate: pending.startDate, status: "ACTIVE", userId: pending.userId,
        })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      } else {
        await expect(service.listAdminMemberships(request, { userId: pending.userId }))
          .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
        expect(membershipPort.update).not.toHaveBeenCalled();
      }
    }
  });

  it("derives own membership queries from the verified session and rejects an IDOR cursor", async () => {
    const { completed, membershipPort, memberships, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "student-own" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt, displayName: "Alumna", email: actor.email, emailVerified: true,
      id: actor.userId, roles: ["STUDENT"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2,
    });
    const own: Membership = {
      createdAt: actor.createdAt, createdBy: "admin", currency: "PYG", endDate: "2026-09-08",
      expectedAmount: 250_000, frequency: "MONTHLY", id: "membership-own", planId: "plan-1",
      planName: "Plan mensual", startDate: "2026-08-08", status: "ACTIVE",
      updatedAt: actor.createdAt, userId: actor.userId, version: 1,
    };
    memberships.set(own.id, own);
    memberships.set("membership-other", { ...own, id: "membership-other", userId: "student-other" });
    vi.mocked(membershipPort.listHistory).mockResolvedValueOnce({
      cursor: { PK: `USER#${actor.userId}`, SK: `MEMBERSHIP#${own.startDate}#${own.id}` },
      memberships: [own],
    });
    const request = new Request("https://app.example.com/api/v1/me/membership", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });
    const result = await service.getOwnMemberships(request, {});
    expect(result).toMatchObject({ active: { id: own.id }, history: [{ id: own.id }] });
    expect(membershipPort.getActive).toHaveBeenCalledWith(actor.userId);
    expect(membershipPort.listHistory).toHaveBeenCalledWith(actor.userId, expect.any(Object));
    const foreignCursor = Buffer.from(JSON.stringify({
      cursor: { PK: "USER#student-other", SK: "MEMBERSHIP#2026-08-08#membership-other" },
      owner: "student-other",
    }), "utf8").toString("base64url");
    await expect(service.getOwnMemberships(request, { cursor: foreignCursor }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(service.listAdminMembershipReport(request, { filter: "status", value: "ACTIVE" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("records an idempotent payment for STAFF and denies unauthorized account states", async () => {
    const { completed, memberships, paymentPort, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "staff-payment" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt, displayName: "Caja", email: actor.email, emailVerified: true,
      id: actor.userId, roles: ["STAFF"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2,
    });
    memberships.set("membership-payment", {
      createdAt: actor.createdAt, createdBy: "admin", currency: "PYG", endDate: "2026-09-08",
      expectedAmount: 250_000, frequency: "MONTHLY", id: "membership-payment", planId: "plan-1",
      planName: "Plan mensual", startDate: "2026-08-08", status: "ACTIVE",
      updatedAt: actor.createdAt, userId: "student-payment", version: 1,
    });
    const request = () => new Request("https://app.example.com/api/v1/admin/payments", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "request-payment-001", origin: config.appBaseUrl }, method: "POST",
    });
    const command = {
      amount: 250_000, membershipId: "membership-payment", membershipStartDate: "2026-08-08",
      method: "CASH" as const, paidAt: "2026-08-08T13:00:00.000Z", periodEnd: "2026-09-08",
      periodStart: "2026-08-08", status: "CONFIRMED" as const, userId: "student-payment",
    };
    await expect(service.recordAdminPayment(request(), "correlation-1", command)).resolves.toMatchObject({ disposition: "CREATED" });
    await expect(service.recordAdminPayment(request(), "correlation-2", command)).resolves.toMatchObject({ disposition: "CREATED" });
    const calls = vi.mocked(paymentPort.record).mock.calls;
    expect(calls[0]?.[0].paymentId).toBe(calls[1]?.[0].paymentId);
    expect(calls[0]?.[0]).toMatchObject({ currency: "PYG", paymentDate: "2026-08-08", recordedBy: actor.userId });

    completed.set(actor.userId, { ...completed.get(actor.userId)!, roles: ["STUDENT"] });
    await expect(service.recordAdminPayment(request(), "correlation-3", command))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("allows catalog reads to STAFF and restricts create or soft-delete to ADMIN", async () => {
    const staffSetup = setup();
    const staffIdentity = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "staff-catalog" };
    await staffSetup.userPort.createPending(staffIdentity);
    staffSetup.completed.set(staffIdentity.userId, { createdAt: staffIdentity.createdAt, displayName: "Staff", email: staffIdentity.email, emailVerified: true, id: staffIdentity.userId, roles: ["STAFF"], status: "ACTIVE", updatedAt: staffIdentity.createdAt, version: 2 });
    const readRequest = new Request("https://app.example.com/api/v1/admin/trainers", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` } });
    await expect(staffSetup.service.listAdminSchedulingCatalog(readRequest, "trainers", { status: "ALL" })).resolves.toMatchObject({ capabilities: { canManage: false } });
    const writeRequest = () => new Request("https://app.example.com/api/v1/admin/trainers", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "POST" });
    await expect(staffSetup.service.createAdminSchedulingCatalog(writeRequest(), "correlation-1", "trainers", { name: "Entrenador" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const adminSetup = setup();
    const adminIdentity = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-catalog" };
    await adminSetup.userPort.createPending(adminIdentity);
    adminSetup.completed.set(adminIdentity.userId, { createdAt: adminIdentity.createdAt, displayName: "Admin", email: adminIdentity.email, emailVerified: true, id: adminIdentity.userId, roles: ["ADMIN"], status: "ACTIVE", updatedAt: adminIdentity.createdAt, version: 2 });
    const created = await adminSetup.service.createAdminSchedulingCatalog(writeRequest(), "correlation-2", "trainers", { name: "Entrenador" });
    await expect(adminSetup.service.updateAdminSchedulingCatalog(new Request("https://app.example.com/api/v1/admin/trainers/id", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "PATCH" }), "correlation-3", "trainers", created.id, { expectedVersion: 1, name: created.name, status: "INACTIVE" })).resolves.toMatchObject({ status: "INACTIVE", version: 2 });
  });

  it("allows active STAFF to create and edit concrete sessions with server-owned names and dates", async () => {
    const { classSessionPort, completed, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "staff-session" };
    await userPort.createPending(actor);
    completed.set(actor.userId, { createdAt: actor.createdAt, displayName: "Staff", email: actor.email, emailVerified: true, id: actor.userId, roles: ["STAFF"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2 });
    const request = () => new Request("https://app.example.com/api/v1/admin/class-sessions", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "POST" });
    const command = { capacity: 12, classTypeId: "type-1", endsAt: "2026-08-10T23:00:00.000Z", startsAt: "2026-08-10T22:00:00.000Z", trainerId: "trainer-1" };
    const created = await service.createAdminClassSession(request(), "correlation-create", command);
    expect(classSessionPort.create).toHaveBeenCalledWith(expect.objectContaining({ classDate: "2026-08-10", classTypeName: "Cross training", createdBy: actor.userId, startTime: "19:00:00", trainerName: "Entrenador" }));
    await expect(service.updateAdminClassSession(new Request(`https://app.example.com/api/v1/admin/class-sessions/${created.id}`, { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, origin: config.appBaseUrl }, method: "PATCH" }), "correlation-update", created.id, { ...command, capacity: 16, expectedVersion: 1 })).resolves.toMatchObject({ capacity: 16, version: 2 });
    await expect(service.cancelAdminClassSession(new Request(`https://app.example.com/api/v1/admin/class-sessions/${created.id}/cancellation`, { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "cancel-session-request-001", origin: config.appBaseUrl }, method: "POST" }), "correlation-cancel", created.id, { expectedVersion: 2, reason: "Entrenador no disponible" })).resolves.toMatchObject({ propagation: { complete: true }, session: { status: "CANCELLED", version: 3 } });
    expect(classSessionPort.cancel).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.userId, reason: "Entrenador no disponible", requestKey: "cancel-session-request-001" }));
    completed.set(actor.userId, { ...completed.get(actor.userId)!, roles: ["STUDENT"] });
    await expect(service.listAdminClassSessions(new Request("https://app.example.com/api/v1/admin/class-sessions?date=2026-08-10", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` } }), { date: "2026-08-10" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(service.cancelAdminClassSession(new Request(`https://app.example.com/api/v1/admin/class-sessions/${created.id}/cancellation`, { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "cancel-session-request-002", origin: config.appBaseUrl }, method: "POST" }), "correlation-forbidden", created.id, { expectedVersion: 3, reason: "Intento sin permisos" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("books only for the authenticated active student with a current membership", async () => {
    const { bookingPort, completed, memberships, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "student-booking" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt, displayName: "Alumna", email: actor.email, emailVerified: true,
      id: actor.userId, roles: ["STUDENT"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2,
    });
    memberships.set("membership-booking", {
      createdAt: actor.createdAt, createdBy: "admin", currency: "PYG", endDate: "2026-09-08",
      expectedAmount: 250_000, frequency: "MONTHLY", id: "membership-booking", planId: "plan-1",
      planName: "Plan mensual", startDate: "2026-08-08", status: "ACTIVE",
      updatedAt: actor.createdAt, userId: actor.userId, version: 1,
    });
    const request = () => new Request("https://app.example.com/api/v1/class-sessions/class-1/reservations", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "booking-request-001", origin: config.appBaseUrl },
      method: "POST",
    });

    await expect(service.reserveOwnClass(request(), "class-1"))
      .resolves.toMatchObject({ reservation: { studentId: actor.userId } });
    expect(bookingPort.reserve).toHaveBeenCalledWith(expect.objectContaining({
      classId: "class-1",
      requestKey: "booking-request-001",
      studentId: actor.userId,
    }));
    const cancelRequest = new Request("https://app.example.com/api/v1/class-sessions/class-1/reservations", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "cancel-booking-request-001", origin: config.appBaseUrl },
      method: "DELETE",
    });
    await expect(service.cancelOwnReservation(cancelRequest, "correlation-cancel", "class-1"))
      .resolves.toMatchObject({ reservation: { status: "CANCELLED", studentId: actor.userId } });
    expect(bookingPort.cancel).toHaveBeenCalledWith(expect.objectContaining({
      actorId: actor.userId,
      cancellationWindowMinutes: 120,
      classId: "class-1",
      settingsVersion: 1,
      studentId: actor.userId,
    }));

    completed.set(actor.userId, { ...completed.get(actor.userId)!, status: "SUSPENDED" });
    await expect(service.reserveOwnClass(request(), "class-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(service.cancelOwnReservation(new Request("https://app.example.com/api/v1/class-sessions/class-1/reservations", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "cancel-booking-suspended", origin: config.appBaseUrl },
      method: "DELETE",
    }), "correlation-suspended", "class-1")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    completed.set(actor.userId, { ...completed.get(actor.userId)!, status: "ACTIVE" });
    memberships.set("membership-booking", { ...memberships.get("membership-booking")!, endDate: "2026-08-07" });
    await expect(service.reserveOwnClass(request(), "class-1"))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("authorizes bounded idempotent gallery uploads only for active staff and admins", async () => {
    const { completed, galleryPort, galleryUploadPort, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "gallery-operator" };
    await userPort.createPending(actor);
    const profile = { createdAt: actor.createdAt, displayName: "Operador", email: actor.email, emailVerified: true, id: actor.userId, roles: ["STAFF"] as const, status: "ACTIVE" as const, updatedAt: actor.createdAt, version: 2 };
    completed.set(actor.userId, profile);
    const request = (key = "gallery-request-001") => new Request("https://app.example.com/api/v1/admin/gallery/uploads", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": key, origin: config.appBaseUrl },
      method: "POST",
    });
    const command = { contentType: "image/jpeg", fileName: "entrenamiento.jpg", size: 4 } as const;

    await expect(service.createGalleryUpload(request(), command)).resolves.toMatchObject({
      assetId: "user-1",
      disposition: "CREATED",
      key: "gallery/originals/user-1.jpg",
      uploadUrl: "/signed-gallery-upload",
    });
    expect(galleryPort.createUpload).toHaveBeenCalledWith(expect.objectContaining({ createdBy: actor.userId, requestKey: "gallery-request-001" }));
    expect(galleryUploadPort.issue).toHaveBeenCalledWith("user-1", "gallery/originals/user-1.jpg", command);

    completed.set(actor.userId, { ...profile, roles: ["ADMIN"] });
    await expect(service.createGalleryUpload(request("gallery-request-002"), command)).resolves.toMatchObject({ disposition: "CREATED" });
    completed.set(actor.userId, { ...profile, roles: ["STUDENT"] });
    await expect(service.createGalleryUpload(request("gallery-request-003"), command)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    completed.set(actor.userId, { ...profile, status: "PENDING" });
    await expect(service.createGalleryUpload(request("gallery-request-004"), command)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(service.createGalleryUpload(request("short"), command)).rejects.toMatchObject({ status: 422 });
    await expect(service.createGalleryUpload(new Request("https://app.example.com/api/v1/admin/gallery/uploads", {
      headers: { "idempotency-key": "gallery-request-005", origin: config.appBaseUrl }, method: "POST",
    }), command)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });
  });

  it("lists only the authenticated student's classes and rejects a foreign reservation cursor", async () => {
    const { classSessionRecords, completed, reservationPort, reservationRecords, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "student-schedule" };
    await userPort.createPending(actor);
    completed.set(actor.userId, { createdAt: actor.createdAt, displayName: "Alumna", email: actor.email, emailVerified: true, id: actor.userId, roles: ["STUDENT"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2 });
    classSessionRecords.push({ capacity: 12, classDate: "2026-08-10", classTypeId: "type-1", classTypeName: "Cross training", confirmedCount: 3, createdAt: actor.createdAt, createdBy: "staff", endsAt: "2026-08-10T23:00:00.000Z", id: "class-own", startTime: "19:00:00", startsAt: "2026-08-10T22:00:00.000Z", status: "SCHEDULED", trainerId: "trainer-1", trainerName: "Entrenador", updatedAt: actor.createdAt, version: 1 });
    reservationRecords.push(
      { classId: "class-own", createdAt: actor.createdAt, id: "reservation-own", startsAt: "2026-08-10T22:00:00.000Z", status: "CONFIRMED", studentId: actor.userId, updatedAt: actor.createdAt, version: 1 },
      { classId: "class-foreign", createdAt: actor.createdAt, id: "reservation-foreign", startsAt: "2026-08-11T22:00:00.000Z", status: "CONFIRMED", studentId: "other", updatedAt: actor.createdAt, version: 1 },
    );
    const request = new Request("https://app.example.com/api/v1/me/classes", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` } });

    await expect(service.getOwnClassSchedule(request, { from: "2026-08-08", to: "2026-08-22" })).resolves.toMatchObject({
      available: [{ id: "class-own" }],
      reservations: [{ classId: "class-own", id: "reservation-own", session: { id: "class-own" } }],
    });
    expect(reservationPort.listByStudent).toHaveBeenCalledWith(actor.userId, expect.objectContaining({ limit: 20 }));
    const foreignCursor = Buffer.from(JSON.stringify({ cursor: { GSI2PK: "USER#other", GSI2SK: "RESERVATION#2026-08-11T22:00:00.000Z#CLASS#class-foreign", PK: "CLASS#class-foreign", SK: "RESERVATION#other" }, owner: "other" }), "utf8").toString("base64url");
    await expect(service.getOwnClassSchedule(request, { cursor: foreignCursor, from: "2026-08-08", to: "2026-08-22" })).rejects.toMatchObject({ status: 422 });
    completed.set(actor.userId, { ...completed.get(actor.userId)!, status: "SUSPENDED" });
    await expect(service.getOwnClassSchedule(request, { from: "2026-08-08", to: "2026-08-22" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("allows only active ADMIN to create linked, idempotent payment corrections", async () => {
    const { completed, paymentPort, paymentRecords, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "admin-correction" };
    await userPort.createPending(actor);
    completed.set(actor.userId, { createdAt: actor.createdAt, displayName: "Admin", email: actor.email, emailVerified: true, id: actor.userId, roles: ["ADMIN"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2 });
    paymentRecords.push({ amount: 100_000, createdAt: actor.createdAt, currency: "PYG", id: "payment-original", membershipId: "membership-1", method: "CASH", paidAt: "2026-08-08T13:00:00.000Z", paymentDate: "2026-08-08", periodEnd: "2026-08-31", periodStart: "2026-08-01", recordedBy: "staff", status: "CONFIRMED", updatedAt: actor.createdAt, userId: "student-1", version: 1 });
    const request = () => new Request("https://app.example.com/api/v1/admin/payments/payment-original/corrections", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token`, "idempotency-key": "correction-request-001", origin: config.appBaseUrl }, method: "POST" });
    const base = { expectedVersion: 1, originalPaidAt: "2026-08-08T13:00:00.000Z", originalPaymentId: "payment-original", reason: "Error administrativo documentado", userId: "student-1" };
    await expect(service.correctAdminPayment(request(), "correlation-1", { ...base, type: "VOID" })).resolves.toMatchObject({ value: { type: "VOID" } });
    await expect(service.correctAdminPayment(request(), "correlation-2", { ...base, amount: 10_000, type: "ADJUSTMENT" })).resolves.toMatchObject({ value: { amount: 10_000 } });
    expect(paymentPort.record).toHaveBeenLastCalledWith(expect.objectContaining({ correction: expect.objectContaining({ originalPaymentId: "payment-original", type: "ADJUSTMENT" }) }));
    completed.set(actor.userId, { ...completed.get(actor.userId)!, roles: ["STAFF"] });
    await expect(service.correctAdminPayment(request(), "correlation-3", { ...base, type: "VOID" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("scopes payment history and receipt access to the authenticated student", async () => {
    const { completed, paymentPort, paymentRecords, receiptPort, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "student-payments" };
    await userPort.createPending(actor);
    completed.set(actor.userId, { createdAt: actor.createdAt, displayName: "Alumna", email: actor.email, emailVerified: true, id: actor.userId, roles: ["STUDENT"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2 });
    paymentRecords.push({ amount: 100_000, createdAt: actor.createdAt, currency: "PYG", id: "payment-own", membershipId: "membership-1", method: "CASH", paidAt: "2026-08-08T13:00:00.000Z", paymentDate: "2026-08-08", periodEnd: "2026-08-31", periodStart: "2026-08-01", receiptKey: "payment-receipts/own.pdf", recordedBy: "staff", status: "CONFIRMED", updatedAt: actor.createdAt, userId: actor.userId, version: 1 });
    const request = new Request("https://app.example.com/api/v1/me/payments", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` } });
    await expect(service.getOwnPayments(request, {})).resolves.toMatchObject({ payments: [{ hasReceipt: true, id: "payment-own" }] });
    expect(paymentPort.listHistory).toHaveBeenCalledWith(actor.userId, expect.any(Object));
    await expect(service.getOwnPaymentReceipt(request, { paidAt: "2026-08-08T13:00:00.000Z", paymentId: "payment-own" })).resolves.toEqual({ url: "/signed-download" });
    expect(receiptPort.issueDownload).toHaveBeenCalledWith("payment-receipts/own.pdf");
    const foreign = Buffer.from(JSON.stringify({ cursor: { PK: "USER#other", SK: "PAYMENT#2026-08-08T13:00:00.000Z#payment-other" }, owner: "other" }), "utf8").toString("base64url");
    await expect(service.getOwnPayments(request, { cursor: foreign })).rejects.toMatchObject({ status: 422 });
  });

  it("allows active STAFF payment reports and denies students", async () => {
    for (const scenario of [{ allowed: true, role: "STAFF" as const }, { allowed: false, role: "STUDENT" as const }]) {
      const { completed, service, userPort } = setup();
      const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: `report-${scenario.role}` };
      await userPort.createPending(actor);
      completed.set(actor.userId, { createdAt: actor.createdAt, displayName: "Actor", email: actor.email, emailVerified: true, id: actor.userId, roles: [scenario.role], status: "ACTIVE", updatedAt: actor.createdAt, version: 2 });
      const request = new Request("https://app.example.com/api/v1/admin/payments", { headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` } });
      const operation = service.listAdminPayments(request, { filter: "date", value: "2026-08-08" });
      if (scenario.allowed) await expect(operation).resolves.toMatchObject({ payments: [] });
      else await expect(operation).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("allows active STAFF reports, binds cursors to the filter and denies inactive actors", async () => {
    const { completed, membershipPort, memberships, service, userPort } = setup();
    const actor = { ...identity, createdAt: "2026-08-08T12:00:00Z", userId: "staff-report" };
    await userPort.createPending(actor);
    completed.set(actor.userId, {
      createdAt: actor.createdAt, displayName: "Personal", email: actor.email, emailVerified: true,
      id: actor.userId, roles: ["STAFF"], status: "ACTIVE", updatedAt: actor.createdAt, version: 2,
    });
    const membership: Membership = {
      createdAt: actor.createdAt, createdBy: "admin", currency: "PYG", endDate: "2026-09-08",
      expectedAmount: 250_000, frequency: "MONTHLY", id: "membership-report", planId: "plan-1",
      planName: "Plan mensual", startDate: "2026-08-08", status: "ACTIVE",
      updatedAt: actor.createdAt, userId: "student-1", version: 1,
    };
    memberships.set(membership.id, membership);
    const cursor = {
      GSI1PK: "MEMBERSHIP_DUE#2026-09-08#S00", GSI1SK: `MEMBERSHIP#${membership.id}`,
      PK: `VIEW#Membership#${membership.id}`, SK: `VIEW#DUE#${membership.userId}`,
    };
    vi.mocked(membershipPort.listDue).mockResolvedValueOnce({
      cursors: { S00: cursor, S01: null, S02: null, S03: null },
      memberships: [membership],
    });
    const request = new Request("https://app.example.com/api/v1/admin/membership-reports", {
      headers: { cookie: `${sessionCookieName(config.environment)}=signed-id-token` },
    });
    const result = await service.listAdminMembershipReport(request, { filter: "due", value: "2026-09-08" });
    expect(result).toMatchObject({ memberships: [{ id: membership.id, standing: "CURRENT" }] });
    expect(result.cursor).toBeDefined();
    if (result.cursor === undefined) throw new Error("missing report cursor");
    await expect(service.listAdminMembershipReport(request, {
      cursor: result.cursor,
      filter: "status",
      value: "ACTIVE",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(membershipPort.listDue).toHaveBeenCalledWith("2026-09-08", expect.objectContaining({ limitPerShard: 10 }));

    const activeActor = completed.get(actor.userId);
    if (activeActor === undefined) throw new Error("missing test actor");
    completed.set(actor.userId, { ...activeActor, status: "SUSPENDED" });
    await expect(service.listAdminMembershipReport(request, { filter: "due", value: "2026-09-08" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
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

  it("validates plan commands and rejects protected or invalid fields", () => {
    expect(validateCreateMembershipPlan({
      currency: "PYG",
      description: "  Acceso   mensual ",
      frequency: "MONTHLY",
      name: " Plan mensual ",
      price: 250_000,
    })).toEqual({
      data: { currency: "PYG", description: "Acceso mensual", frequency: "MONTHLY", name: "Plan mensual", price: 250_000 },
      success: true,
    });
    expect(validateCreateMembershipPlan({ currency: "USD", frequency: "MONTHLY", name: "X", price: 1, actorId: "attacker" }))
      .toMatchObject({ success: false });
    expect(validateUpdateMembershipPlan({ currency: "PYG", expectedVersion: 2, frequency: "ANNUAL", name: "Anual", price: 2_000_000, status: "INACTIVE" }))
      .toMatchObject({ data: { expectedVersion: 2, status: "INACTIVE" }, success: true });
    expect(validateMembershipPlanQuery(new URLSearchParams("status=ACTIVE")))
      .toEqual({ data: { status: "ACTIVE" }, success: true });
    expect(validateMembershipPlanQuery(new URLSearchParams("status=ACTIVE&userId=other")))
      .toMatchObject({ success: false });
  });
});

describe("membership query validation", () => {
  it("accepts exact due/status reports and rejects invalid dates, fields and cursors", () => {
    expect(validateMembershipReportQuery(new URLSearchParams({ filter: "due", value: "2026-09-08" })))
      .toMatchObject({ data: { filter: "due", value: "2026-09-08" }, success: true });
    expect(validateMembershipReportQuery(new URLSearchParams({ filter: "status", value: "ACTIVE" })))
      .toMatchObject({ data: { filter: "status", value: "ACTIVE" }, success: true });
    expect(validateMembershipReportQuery(new URLSearchParams({ filter: "due", value: "2026-02-30" })))
      .toMatchObject({ success: false });
    expect(validateMembershipReportQuery(new URLSearchParams({ filter: "status", value: "UNKNOWN" })))
      .toMatchObject({ success: false });
    expect(validateMembershipReportQuery(new URLSearchParams({ filter: "due", userId: "other", value: "2026-09-08" })))
      .toMatchObject({ success: false });
    expect(validateOwnMembershipQuery(new URLSearchParams({ cursor: "not+base64" })))
      .toMatchObject({ success: false });
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
