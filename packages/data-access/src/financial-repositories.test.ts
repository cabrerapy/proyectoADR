import { describe, expect, it, vi } from "vitest";

import type { DynamoDbDocumentPort } from "./dynamodb-adapter";
import { MembershipRepository } from "./membership-repository";
import { PaymentRepository } from "./payment-repository";

const metadata = { httpStatusCode: 200 };

const createPort = (): DynamoDbDocumentPort => ({
  batchGet: vi.fn(async () => ({ $metadata: metadata })),
  destroy: vi.fn(),
  get: vi.fn(async () => ({ $metadata: metadata })),
  put: vi.fn(async () => ({ $metadata: metadata })),
  query: vi.fn(async () => ({ $metadata: metadata })),
  transactWrite: vi.fn(async () => ({ $metadata: metadata })),
});

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

describe("financial repositories", () => {
  it("creates membership, pointer, and both views in one transaction", async () => {
    const port = createPort();
    const repository = new MembershipRepository(port, "gym-adr-platform-local");

    await expect(repository.create(membershipInput)).resolves.toMatchObject({
      id: "membership-001",
      status: "ACTIVE",
      version: 1,
    });

    const transaction = vi.mocked(port.transactWrite).mock.calls[0]?.[0];
    expect(transaction?.TransactItems).toHaveLength(7);
    expect(transaction?.TransactItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ConditionCheck: expect.any(Object) }),
        expect.objectContaining({
          Put: expect.objectContaining({
            Item: expect.objectContaining({ entityType: "ActiveMembershipPointer" }),
          }),
        }),
        expect.objectContaining({
          Put: expect.objectContaining({
            Item: expect.objectContaining({ purpose: "DUE" }),
          }),
        }),
        expect.objectContaining({
          Put: expect.objectContaining({
            Item: expect.objectContaining({ purpose: "STATUS" }),
          }),
        }),
      ]),
    );
  });

  it("rejects invalid membership dates before writing", async () => {
    const port = createPort();
    const repository = new MembershipRepository(port, "gym-adr-platform-local");

    await expect(
      repository.create({ ...membershipInput, endDate: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(port.transactWrite).not.toHaveBeenCalled();
  });

  it("records canonical payment, two views, references, and idempotency atomically", async () => {
    const port = createPort();
    vi.mocked(port.get).mockResolvedValue({
      $metadata: metadata,
      Item: {
        PK: "USER#user-001",
        SK: "PAYMENT#2026-08-08T13:00:00Z#payment-001",
        amount: 250_000,
        createdAt: "2026-08-08T13:00:00Z",
        currency: "PYG",
        entityType: "Payment",
        membershipId: "membership-001",
        method: "CASH",
        paidAt: "2026-08-08T13:00:00Z",
        paymentDate: "2026-08-08",
        paymentId: "payment-001",
        periodEnd: "2026-09-08",
        periodStart: "2026-08-08",
        recordedBy: "staff-001",
        schemaVersion: 1,
        status: "CONFIRMED",
        updatedAt: "2026-08-08T13:00:00Z",
        userId: "user-001",
        version: 1,
      },
    });
    const repository = new PaymentRepository(port, "gym-adr-platform-local");

    await expect(repository.record(paymentInput)).resolves.toMatchObject({
      disposition: "CREATED",
      value: { id: "payment-001", status: "CONFIRMED" },
    });

    const transaction = vi.mocked(port.transactWrite).mock.calls[0]?.[0];
    expect(transaction?.TransactItems).toHaveLength(6);
    expect(transaction?.TransactItems?.filter(({ ConditionCheck }) =>
      ConditionCheck !== undefined
    )).toHaveLength(2);
    expect(transaction?.TransactItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Put: expect.objectContaining({
            Item: expect.objectContaining({ entityType: "Idempotency" }),
          }),
        }),
      ]),
    );
  });
});
