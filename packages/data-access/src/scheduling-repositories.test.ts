import { describe, expect, it, vi } from "vitest";

import { ClassSessionRepository } from "./class-session-repository";
import type { DynamoDbDocumentPort } from "./dynamodb-adapter";
import { ReservationRepository } from "./reservation-repository";

const metadata = { httpStatusCode: 200 };

const createPort = (): DynamoDbDocumentPort => ({
  batchGet: vi.fn(async () => ({ $metadata: metadata })),
  destroy: vi.fn(),
  get: vi.fn(async () => ({ $metadata: metadata })),
  put: vi.fn(async () => ({ $metadata: metadata })),
  query: vi.fn(async () => ({ $metadata: metadata })),
  transactWrite: vi.fn(async () => ({ $metadata: metadata })),
});

const classInput = {
  capacity: 16,
  classDate: "2026-08-10",
  classId: "class-001",
  classTypeId: "type-001",
  classTypeName: "Cross training",
  createdAt: "2026-08-08T12:00:00Z",
  createdBy: "staff-001",
  endsAt: "2026-08-10T23:00:00Z",
  startTime: "18:00:00",
  startsAt: "2026-08-10T22:00:00Z",
  trainerId: "trainer-001",
  trainerName: "Entrenador Uno",
} as const;

describe("scheduling repositories", () => {
  it("creates an indexed session after checking active references", async () => {
    const port = createPort();
    const repository = new ClassSessionRepository(port, "gym-adr-platform-local");

    await expect(repository.create(classInput)).resolves.toMatchObject({
      confirmedCount: 0,
      id: "class-001",
      status: "SCHEDULED",
      version: 1,
    });

    const items = vi.mocked(port.transactWrite).mock.calls[0]?.[0].TransactItems;
    expect(items).toHaveLength(3);
    expect(items?.filter(({ ConditionCheck }) => ConditionCheck !== undefined))
      .toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        Put: expect.objectContaining({
          Item: expect.objectContaining({
            GSI1PK: expect.stringMatching(/^CLASS_DATE#/u),
            GSI1SK: expect.stringMatching(/^AVAILABLE#/u),
            GSI2PK: "TRAINER#trainer-001",
          }),
        }),
      }),
    ]));
  });

  it("rejects invalid capacity and time before writing", async () => {
    const port = createPort();
    const repository = new ClassSessionRepository(port, "gym-adr-platform-local");

    await expect(repository.create({ ...classInput, capacity: 0 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(repository.create({ ...classInput, startTime: "25:00:00" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(port.transactWrite).not.toHaveBeenCalled();
  });

  it("builds a versioned capacity update that cannot exceed capacity", async () => {
    const port = createPort();
    const repository = new ClassSessionRepository(port, "gym-adr-platform-local");
    const session = await repository.create({ ...classInput, capacity: 1 });
    const item = vi.mocked(port.transactWrite).mock.calls[0]?.[0].TransactItems
      ?.find(({ Put }) => Put?.Item?.entityType === "ClassSession")?.Put?.Item;
    expect(item).toBeDefined();
    if (item === undefined) {
      throw new Error("La transacción de prueba no contiene la sesión.");
    }
    vi.mocked(port.get).mockResolvedValueOnce({ $metadata: metadata, Item: item });

    const result = await repository.prepareReserveCapacityUpdate(
      session.id,
      "2026-08-08T13:00:00Z",
    );

    expect(result.nextSession).toMatchObject({
      confirmedCount: 1,
      version: 2,
    });
    expect(result.action).toEqual({
      Update: expect.objectContaining({
        ConditionExpression: expect.stringContaining("#confirmedCount < #capacity"),
        ExpressionAttributeValues: expect.objectContaining({
          ":expectedCount": 0,
          ":expectedVersion": 1,
          ":gsi1sk": expect.stringMatching(/^FULL#/u),
          ":nextCount": 1,
        }),
      }),
    });
  });

  it("builds a reservation put that can only be composed transactionally", () => {
    const port = createPort();
    const repository = new ReservationRepository(port, "gym-adr-platform-local");

    const result = repository.buildConfirmedPut({
      classId: "class-001",
      createdAt: "2026-08-08T13:00:00Z",
      reservationId: "reservation-001",
      startsAt: "2026-08-10T22:00:00Z",
      studentId: "student-001",
    });

    expect(result.reservation).toMatchObject({
      classId: "class-001",
      status: "CONFIRMED",
      studentId: "student-001",
    });
    expect(result.action).toEqual({
      Put: expect.objectContaining({
        ConditionExpression:
          "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        Item: expect.objectContaining({
          GSI2PK: "USER#student-001",
          PK: "CLASS#class-001",
          SK: "RESERVATION#student-001",
        }),
      }),
    });
    expect(port.transactWrite).not.toHaveBeenCalled();
  });
});
