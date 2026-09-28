import {
  ClassSessionRepository,
  GymSettingsRepository,
  MembershipPlanRepository,
  MembershipRepository,
  PaymentRepository,
  SchedulingCatalogRepository,
  SearchTokenService,
  UserRepository,
  createDynamoDbAdapter,
} from "@gym-adr/data-access";
import type { UserRole, UserStatus } from "@gym-adr/domain";

import { LOCAL_IDENTITIES, type LocalIdentityAlias } from "../auth/local-token-client";

export interface LocalFixtureSummary {
  readonly classId: string;
  readonly classDate: string;
  readonly tableName: string;
  readonly users: Readonly<Record<LocalIdentityAlias, string>>;
}

const userDefinitions: Readonly<Record<LocalIdentityAlias, {
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
}>> = {
  admin: { roles: ["ADMIN"], status: "ACTIVE" },
  inactive: { roles: ["STUDENT"], status: "INACTIVE" },
  pending: { roles: ["STUDENT"], status: "PENDING" },
  staff: { roles: ["STAFF"], status: "ACTIVE" },
  student: { roles: ["STUDENT"], status: "ACTIVE" },
  suspended: { roles: ["STUDENT"], status: "SUSPENDED" },
};

const localDate = (): string => new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Asuncion",
  year: "numeric",
}).format(new Date());

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const sameRoles = (left: readonly UserRole[], right: readonly UserRole[]): boolean =>
  left.length === right.length && left.every((role) => right.includes(role));

export const seedLocalFixtures = async (): Promise<LocalFixtureSummary> => {
  if (process.env.APP_ENVIRONMENT !== "local" || process.env.LOCAL_AUTH_ENABLED !== "1") {
    throw new Error("Los fixtures locales solo pueden ejecutarse en APP_ENVIRONMENT=local.");
  }
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  const searchKey = process.env.SEARCH_TOKEN_HMAC_KEY;
  if (tableName === undefined || searchKey === undefined || searchKey.length < 32) {
    throw new Error("La configuración local de DynamoDB o búsqueda está incompleta.");
  }

  const adapter = createDynamoDbAdapter({
    environment: "local",
    ...(process.env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : { endpoint: process.env.DYNAMODB_ENDPOINT }),
  });
  const users = new UserRepository(
    adapter,
    tableName,
    new SearchTokenService([{ secret: new TextEncoder().encode(searchKey), version: "v1" }]),
  );
  const plans = new MembershipPlanRepository(adapter, tableName);
  const memberships = new MembershipRepository(adapter, tableName);
  const payments = new PaymentRepository(adapter, tableName);
  const catalog = new SchedulingCatalogRepository(adapter, tableName);
  const sessions = new ClassSessionRepository(adapter, tableName);
  const settings = new GymSettingsRepository(adapter, tableName);
  const fixtureUsers = {} as Record<LocalIdentityAlias, string>;

  try {
    let sequence = 0;
    for (const alias of Object.keys(LOCAL_IDENTITIES) as LocalIdentityAlias[]) {
      sequence += 1;
      const identity = LOCAL_IDENTITIES[alias];
      const definition = userDefinitions[alias];
      const userId = `fixture-${alias}`;
      fixtureUsers[alias] = userId;
      const createdAt = `2026-01-01T12:${String(sequence).padStart(2, "0")}:00.000Z`;
      await users.createPending({
        cognitoSub: identity.cognitoSub,
        createdAt,
        displayName: identity.displayName,
        email: identity.email,
        emailVerified: true,
        userId,
      });
      let profile = await users.getById(userId, true);
      if (profile === undefined) throw new Error(`No se creó el fixture ${alias}.`);
      if (profile.onboardingCompletedAt === undefined) {
        profile = await users.completePendingProfile({
          displayName: identity.displayName,
          expectedVersion: profile.version,
          onboardingCompletedAt: `2026-01-01T13:${String(sequence).padStart(2, "0")}:00.000Z`,
          phone: `+595981000${String(sequence).padStart(3, "0")}`,
          userId,
        });
      }
      if (profile.status !== definition.status || !sameRoles(profile.roles, definition.roles)) {
        await users.update({
          displayName: profile.displayName,
          email: profile.email,
          emailNotificationsEnabled: true,
          emailVerified: true,
          expectedVersion: profile.version,
          ...(profile.phone === undefined ? {} : { phone: profile.phone }),
          roles: definition.roles,
          status: definition.status,
          updatedAt: `2026-01-01T14:${String(sequence).padStart(2, "0")}:00.000Z`,
          userId,
        });
      }
    }

    const adminId = fixtureUsers.admin;
    const studentId = fixtureUsers.student;
    const planId = "fixture-plan-monthly";
    if (await plans.getById(planId, true) === undefined) {
      await plans.create({
        actorId: adminId,
        auditId: "fixture-audit-plan",
        correlationId: "fixture-correlation-plan",
        createdAt: "2026-01-02T12:00:00.000Z",
        currency: "PYG",
        description: "Plan mensual local para pruebas integrales.",
        frequency: "MONTHLY",
        name: "Plan local mensual",
        planId,
        price: 250_000,
      });
    }

    const today = localDate();
    const startDate = addDays(today, -7);
    const endDate = addDays(today, 30);
    const membershipId = "fixture-membership-active";
    if (await memberships.getActive(studentId) === undefined) {
      await memberships.create({
        auditId: "fixture-audit-membership",
        correlationId: "fixture-correlation-membership",
        createdAt: `${today}T12:00:00.000Z`,
        createdBy: adminId,
        currency: "PYG",
        endDate,
        expectedAmount: 250_000,
        frequency: "MONTHLY",
        membershipId,
        planId,
        planName: "Plan local mensual",
        startDate,
        status: "ACTIVE",
        userId: studentId,
      });
    }

    const paidAt = `${today}T13:00:00.000Z`;
    if (await payments.getById(studentId, paidAt, "fixture-payment-confirmed") === undefined) {
      await payments.record({
        amount: 250_000,
        auditId: "fixture-audit-payment",
        correlationId: "fixture-correlation-payment",
        createdAt: paidAt,
        currency: "PYG",
        membershipId,
        membershipStartDate: startDate,
        method: "CASH",
        notes: "Pago ficticio para entorno local",
        paidAt,
        paymentDate: today,
        paymentId: "fixture-payment-confirmed",
        periodEnd: endDate,
        periodStart: startDate,
        recordedBy: adminId,
        requestKey: "fixture-payment-request",
        status: "CONFIRMED",
        userId: studentId,
      });
    }

    const trainerId = "fixture-trainer";
    if (await catalog.getTrainer(trainerId) === undefined) {
      await catalog.createTrainer({
        actorId: adminId,
        auditId: "fixture-audit-trainer",
        correlationId: "fixture-correlation-trainer",
        createdAt: "2026-01-02T13:00:00.000Z",
        description: "Entrenadora ficticia para desarrollo local.",
        id: trainerId,
        name: "Carla Entrenadora",
      });
    }
    const classTypeId = "fixture-class-type";
    if (await catalog.getClassType(classTypeId) === undefined) {
      await catalog.createClassType({
        actorId: adminId,
        auditId: "fixture-audit-class-type",
        correlationId: "fixture-correlation-class-type",
        createdAt: "2026-01-02T13:10:00.000Z",
        description: "Cross training adaptable a todos los niveles.",
        id: classTypeId,
        name: "Cross training local",
      });
    }
    const classId = "fixture-class-reservable";
    const classDate = addDays(today, 1);
    if (await sessions.getById(classId, true) === undefined) {
      await sessions.create({
        auditId: "fixture-audit-class",
        capacity: 12,
        classDate,
        classId,
        classTypeId,
        classTypeName: "Cross training local",
        createdAt: `${today}T14:00:00.000Z`,
        createdBy: adminId,
        correlationId: "fixture-correlation-class",
        endsAt: `${classDate}T22:00:00.000Z`,
        startTime: "18:00:00",
        startsAt: `${classDate}T21:00:00.000Z`,
        trainerId,
        trainerName: "Carla Entrenadora",
      });
    }

    if (await settings.get() === undefined) {
      await settings.create({
        auditId: "fixture-audit-settings",
        cancellationWindowMinutes: 120,
        correlationId: "fixture-correlation-settings",
        currency: "PYG",
        gymName: "Gym ADR Local",
        timezone: "America/Asuncion",
        updatedAt: `${today}T15:00:00.000Z`,
        updatedBy: adminId,
        whatsappNumber: "+595981000000",
      });
    }

    return { classDate, classId, tableName, users: fixtureUsers };
  } finally {
    users.destroy();
    plans.destroy();
    memberships.destroy();
    payments.destroy();
    catalog.destroy();
    sessions.destroy();
  }
};
