import { describe, expect, it, vi } from "vitest";

import { BookingRepository } from "./booking-repository";
import { ClassSessionRepository } from "./class-session-repository";
import type { DynamoDbDocumentPort } from "./dynamodb-adapter";

const metadata = { httpStatusCode: 200 };
const createPort = (): DynamoDbDocumentPort => ({
  batchGet: vi.fn(async () => ({ $metadata: metadata })),
  destroy: vi.fn(),
  get: vi.fn(async () => ({ $metadata: metadata })),
  put: vi.fn(async () => ({ $metadata: metadata })),
  query: vi.fn(async () => ({ $metadata: metadata })),
  transactWrite: vi.fn(async () => ({ $metadata: metadata })),
});

describe("BookingRepository", () => {
  it("composes class, profile, membership, duplicate and idempotency in one transaction", async () => {
    const port = createPort();
    const sessions = new ClassSessionRepository(port, "gym-adr-platform-local");
    await sessions.create({
      auditId: "audit-class-001",
      capacity: 10,
      classDate: "2026-08-10",
      classId: "class-001",
      classTypeId: "type-001",
      classTypeName: "Cross training",
      createdAt: "2026-08-08T10:00:00Z",
      createdBy: "staff-001",
      correlationId: "correlation-class-001",
      endsAt: "2026-08-10T23:00:00Z",
      startTime: "18:00:00",
      startsAt: "2026-08-10T22:00:00Z",
      trainerId: "trainer-001",
      trainerName: "Entrenador Uno",
    });
    const sessionItem = vi.mocked(port.transactWrite).mock.calls[0]?.[0]
      .TransactItems?.find(({ Put }) => Put?.Item?.entityType === "ClassSession")
      ?.Put?.Item;
    expect(sessionItem).toBeDefined();
    vi.mocked(port.transactWrite).mockClear();
    vi.mocked(port.get)
      .mockResolvedValueOnce({ $metadata: metadata })
      .mockResolvedValueOnce({ $metadata: metadata, Item: sessionItem });

    const result = await new BookingRepository(port, "gym-adr-platform-local").reserve({
      classId: "class-001",
      createdAt: "2026-08-08T12:00:00Z",
      requestKey: "booking-request-001",
      reservationId: "reservation-001",
      studentId: "student-001",
      todayEpochDay: 20_673,
    });

    expect(result).toMatchObject({
      disposition: "CREATED",
      reservation: { classId: "class-001", status: "CONFIRMED", studentId: "student-001" },
    });
    const actions = vi.mocked(port.transactWrite).mock.calls[0]?.[0].TransactItems;
    expect(actions).toHaveLength(5);
    expect(actions?.[0]?.Update?.ConditionExpression).toContain("#confirmedCount < #capacity");
    expect(actions?.[1]?.ConditionCheck?.Key).toEqual({ PK: "USER#student-001", SK: "PROFILE" });
    expect(actions?.[2]?.ConditionCheck?.Key).toEqual({ PK: "USER#student-001", SK: "MEMBERSHIP#ACTIVE" });
    expect(actions?.[3]?.Put?.Item).toMatchObject({ PK: "CLASS#class-001", SK: "RESERVATION#student-001" });
    expect(actions?.[4]?.Put?.Item).toMatchObject({ entityType: "Idempotency", status: "COMPLETED" });
  });
});
