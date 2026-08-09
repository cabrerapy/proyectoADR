import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDynamoDbAdapter,
  AuditLogRepository,
  MembershipRepository,
  PaymentRepository,
  primaryKeys,
} from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-financial-${Date.now()}`;
const client = new DynamoDBClient({
  credentials: {
    accessKeyId: "localplaceholder",
    secretAccessKey: "localplaceholder",
  },
  endpoint: "http://127.0.0.1:8000",
  region: "local",
});
const adapter = createDynamoDbAdapter({ environment: "local" });
const memberships = new MembershipRepository(adapter, tableName);
const audits = new AuditLogRepository(adapter, tableName);
const payments = new PaymentRepository(adapter, tableName);

const membershipInput = {
  auditId: "audit-membership-001",
  correlationId: "correlation-membership-001",
  createdAt: "2026-08-08T12:00:00Z",
  createdBy: "admin-001",
  currency: "PYG",
  endDate: "2026-09-08",
  expectedAmount: 250_000,
  frequency: "MONTHLY",
  membershipId: "membership-001",
  planId: "plan-001",
  planName: "Plan mensual",
  startDate: "2026-08-08",
  status: "ACTIVE",
  userId: "user-001",
} as const;

const paymentInput = {
  amount: 250_000,
  createdAt: "2026-08-08T13:00:00Z",
  currency: "PYG",
  membershipId: "membership-001",
  membershipStartDate: "2026-08-08",
  method: "CASH",
  notes: "Cuota de agosto",
  paidAt: "2026-08-08T13:00:00Z",
  paymentDate: "2026-08-08",
  paymentId: "payment-001",
  periodEnd: "2026-09-08",
  periodStart: "2026-08-08",
  recordedBy: "staff-001",
  requestKey: "request-payment-001",
  status: "CONFIRMED",
  userId: "user-001",
} as const;

describe.skipIf(!enabled)("financial repositories with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1-Operational",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        TableName: tableName,
      }),
    );
    for (const userId of ["user-001", "user-002", "user-003"]) {
      await adapter.put({
        Item: {
          ...primaryKeys.userProfile(userId),
          createdAt: "2026-08-08T10:00:00Z",
          entityType: "UserProfile",
          roles: ["STUDENT"],
          schemaVersion: 1,
          status: "ACTIVE",
          updatedAt: "2026-08-08T10:00:00Z",
          userId,
        },
        TableName: tableName,
      });
    }
    await adapter.put({
      Item: {
        ...primaryKeys.membershipPlan("plan-001"),
        createdAt: "2026-08-08T10:00:00Z",
        createdBy: "admin-001",
        currency: "PYG",
        entityType: "MembershipPlan",
        frequency: "MONTHLY",
        name: "Plan mensual",
        planId: "plan-001",
        price: 250_000,
        schemaVersion: 1,
        status: "ACTIVE",
        updatedAt: "2026-08-08T10:00:00Z",
        updatedBy: "admin-001",
        version: 1,
      },
      TableName: tableName,
    });
  });

  afterAll(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      payments.destroy();
      client.destroy();
    }
  });

  it("persists active pointer, history, due and status views", async () => {
    await expect(memberships.create(membershipInput)).resolves.toMatchObject({
      id: "membership-001",
      status: "ACTIVE",
    });
    await expect(memberships.getActive("user-001"))
      .resolves.toMatchObject({ id: "membership-001" });
    await expect(memberships.listHistory("user-001", { consistentRead: true }))
      .resolves.toMatchObject({ memberships: [{ id: "membership-001" }] });
    await expect(memberships.listDue("2026-09-08"))
      .resolves.toMatchObject({ memberships: [{ id: "membership-001" }] });
    await expect(memberships.listByStatus("ACTIVE"))
      .resolves.toMatchObject({ memberships: [{ id: "membership-001" }] });
  });

  it("prevents two simultaneous active memberships for one student", async () => {
    const attempts = await Promise.allSettled([
      memberships.create({
        ...membershipInput,
        membershipId: "membership-002",
        userId: "user-002",
      }),
      memberships.create({
        ...membershipInput,
        membershipId: "membership-003",
        userId: "user-002",
      }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.find(({ status }) => status === "rejected"))
      .toMatchObject({ reason: { code: "MEMBERSHIP_CONFLICT" } });
  });

  it("moves a pending membership through the active pointer and suspension atomically", async () => {
    const pending = await memberships.create({
      ...membershipInput,
      auditId: "audit-membership-pending",
      membershipId: "membership-004",
      status: "PENDING",
      userId: "user-003",
    });
    expect(await memberships.getActive("user-003")).toBeUndefined();
    const active = await memberships.update({
      actorId: "admin-001",
      auditId: "audit-membership-active",
      correlationId: "correlation-membership-active",
      endDate: pending.endDate,
      expectedAmount: pending.expectedAmount,
      expectedVersion: pending.version,
      membershipId: pending.id,
      startDate: pending.startDate,
      status: "ACTIVE",
      updatedAt: "2026-08-08T12:05:00Z",
      userId: pending.userId,
    });
    await expect(memberships.getActive("user-003")).resolves.toMatchObject({
      id: pending.id,
      status: "ACTIVE",
    });
    const suspended = await memberships.update({
      actorId: "admin-001",
      auditId: "audit-membership-suspended",
      correlationId: "correlation-membership-suspended",
      endDate: active.endDate,
      expectedAmount: active.expectedAmount,
      expectedVersion: active.version,
      membershipId: active.id,
      reason: "Solicitud administrativa documentada",
      startDate: active.startDate,
      status: "SUSPENDED",
      updatedAt: "2026-08-08T12:10:00Z",
      userId: active.userId,
    });
    expect(suspended).toMatchObject({ status: "SUSPENDED", version: 3 });
    expect(await memberships.getActive("user-003")).toBeUndefined();
    await expect(audits.listByEntity(
      "Membership",
      pending.id,
      "2026-08-08T00:00:00Z",
      "2026-08-09T00:00:00Z",
    )).resolves.toMatchObject({ entries: [{ action: "MEMBERSHIP_CREATED" }, { action: "MEMBERSHIP_STATUS_ACTIVE" }, { action: "MEMBERSHIP_STATUS_SUSPENDED" }] });
  });

  it("records one idempotent payment and resolves history/date/status", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => payments.record(paymentInput)),
    );
    expect(attempts.filter(({ disposition }) => disposition === "CREATED"))
      .toHaveLength(1);
    expect(attempts.filter(({ disposition }) => disposition === "REPLAYED"))
      .toHaveLength(7);
    await expect(
      payments.record({ ...paymentInput, amount: 300_000 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(payments.listHistory("user-001", { consistentRead: true }))
      .resolves.toMatchObject({ payments: [{ id: "payment-001" }] });
    await expect(payments.listByDate("2026-08-08"))
      .resolves.toMatchObject({ payments: [{ id: "payment-001" }] });
    await expect(payments.listByStatus("CONFIRMED"))
      .resolves.toMatchObject({ payments: [{ id: "payment-001" }] });
  });

  it("voids idempotently without deleting the confirmed payment history", async () => {
    const input = {
      actorId: "admin-001",
      correctedAt: "2026-08-08T14:00:00Z",
      correctionId: "correction-001",
      expectedVersion: 1,
      originalPaidAt: paymentInput.paidAt,
      paymentId: paymentInput.paymentId,
      reason: "Registro duplicado confirmado por administración",
      requestKey: "request-void-001",
      userId: paymentInput.userId,
    } as const;
    await expect(payments.voidConfirmed(input)).resolves.toMatchObject({
      disposition: "CREATED",
      value: { id: "correction-001", type: "VOID" },
    });
    await expect(payments.voidConfirmed(input)).resolves.toMatchObject({
      disposition: "REPLAYED",
      value: { id: "correction-001", type: "VOID" },
    });
    await expect(
      payments.voidConfirmed({ ...input, reason: "Motivo incompatible" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      payments.getById(paymentInput.userId, paymentInput.paidAt, paymentInput.paymentId),
    ).resolves.toMatchObject({ status: "VOIDED", version: 2 });
    await expect(payments.listByStatus("CONFIRMED"))
      .resolves.toMatchObject({ payments: [] });
    await expect(payments.listByStatus("VOIDED"))
      .resolves.toMatchObject({ payments: [{ id: "payment-001" }] });
    await expect(payments.listByDate("2026-08-08"))
      .resolves.toMatchObject({ payments: [{ id: "payment-001", status: "VOIDED" }] });
  });
});
