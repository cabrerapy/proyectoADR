import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClassSessionRepository,
  createDynamoDbAdapter,
  ReservationRepository,
  SchedulingCatalogRepository,
  AuditLogRepository,
} from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-scheduling-${Date.now()}`;
const client = new DynamoDBClient({
  credentials: {
    accessKeyId: "localplaceholder",
    secretAccessKey: "localplaceholder",
  },
  endpoint: "http://127.0.0.1:8000",
  region: "local",
});
const adapter = createDynamoDbAdapter({ environment: "local" });
const sessions = new ClassSessionRepository(adapter, tableName);
const reservations = new ReservationRepository(adapter, tableName);
const catalog = new SchedulingCatalogRepository(adapter, tableName);
const audits = new AuditLogRepository(adapter, tableName);

const firstClass = {
  auditId: "audit-class-001",
  capacity: 16,
  classDate: "2026-08-10",
  classId: "class-001",
  classTypeId: "type-001",
  classTypeName: "Cross training",
  createdAt: "2026-08-08T12:00:00Z",
  createdBy: "staff-001",
  correlationId: "correlation-class-001",
  endsAt: "2026-08-10T23:00:00Z",
  startTime: "18:00:00",
  startsAt: "2026-08-10T22:00:00Z",
  trainerId: "trainer-001",
  trainerName: "Entrenador Uno",
} as const;

describe.skipIf(!enabled)("scheduling repositories with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
          { AttributeName: "GSI2PK", AttributeType: "S" },
          { AttributeName: "GSI2SK", AttributeType: "S" },
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
          {
            IndexName: "GSI2-Relationships",
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
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
    await catalog.createTrainer({ actorId: "admin-001", auditId: "audit-trainer-001", correlationId: "correlation-trainer-001", createdAt: "2026-08-08T10:00:00Z", id: "trainer-001", name: "Entrenador Uno" });
    await catalog.createTrainer({ actorId: "admin-001", auditId: "audit-trainer-003", correlationId: "correlation-trainer-003", createdAt: "2026-08-08T10:00:00Z", id: "trainer-003", name: "Entrenadora Tres" });
    await catalog.createClassType({ actorId: "admin-001", auditId: "audit-type-001", correlationId: "correlation-type-001", createdAt: "2026-08-08T10:00:00Z", id: "type-001", name: "Cross training" });
  });

  afterAll(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      sessions.destroy();
      catalog.destroy();
      client.destroy();
    }
  });

  it("creates, lists and soft-deletes catalog entries with immutable audit", async () => {
    const trainer = await catalog.createTrainer({ actorId: "admin-001", auditId: "audit-trainer-002", correlationId: "correlation-trainer-002", createdAt: "2026-08-08T10:10:00Z", description: "Especialista en fuerza", id: "trainer-002", name: "Entrenadora Dos" });
    await expect(catalog.listTrainers("ACTIVE")).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: trainer.id })]) });
    await expect(catalog.updateTrainer({ actorId: "admin-001", auditId: "audit-trainer-inactive", correlationId: "correlation-trainer-inactive", ...(trainer.bio === undefined ? {} : { description: trainer.bio }), expectedVersion: trainer.version, id: trainer.id, name: trainer.name, status: "INACTIVE", updatedAt: "2026-08-08T10:20:00Z" })).resolves.toMatchObject({ id: trainer.id, status: "INACTIVE", version: 2 });
    await expect(catalog.getTrainer(trainer.id)).resolves.toMatchObject({ id: trainer.id, status: "INACTIVE" });
    const auditPage = await audits.listByEntity("Trainer", trainer.id, "2026-08-08T00:00:00Z", "2026-08-09T00:00:00Z");
    expect(auditPage.entries.map(({ action }) => action)).toEqual(["TRAINER_CREATED", "TRAINER_STATUS_INACTIVE"]);
    const classType = await catalog.createClassType({ actorId: "admin-001", auditId: "audit-type-002", correlationId: "correlation-type-002", createdAt: "2026-08-08T10:30:00Z", description: "Trabajo de movilidad", id: "type-002", name: "Movilidad" });
    await expect(catalog.updateClassType({ actorId: "admin-001", auditId: "audit-type-inactive", correlationId: "correlation-type-inactive", ...(classType.description === undefined ? {} : { description: classType.description }), expectedVersion: classType.version, id: classType.id, name: classType.name, status: "INACTIVE", updatedAt: "2026-08-08T10:40:00Z" })).resolves.toMatchObject({ id: classType.id, status: "INACTIVE", version: 2 });
    await expect(catalog.listClassTypes("INACTIVE")).resolves.toMatchObject({ items: [expect.objectContaining({ id: classType.id })] });
  });

  it("resolves sessions by id, date, trainer and available period", async () => {
    await sessions.create(firstClass);
    await sessions.create({
      ...firstClass,
      auditId: "audit-class-002",
      classId: "class-002",
      endsAt: "2026-08-11T00:00:00Z",
      startTime: "19:00:00",
      startsAt: "2026-08-10T23:00:00Z",
    });
    await sessions.create({
      ...firstClass,
      auditId: "audit-class-003",
      classDate: "2026-08-11",
      classId: "class-003",
      endsAt: "2026-08-11T23:00:00Z",
      startsAt: "2026-08-11T22:00:00Z",
    });

    await expect(sessions.getById("class-001"))
      .resolves.toMatchObject({ id: "class-001" });
    await expect(sessions.listByDate("2026-08-10"))
      .resolves.toMatchObject({ sessions: [{ id: "class-001" }, { id: "class-002" }] });
    await expect(sessions.listByTrainer("trainer-001"))
      .resolves.toMatchObject({ sessions: [{ id: "class-001" }, { id: "class-002" }, { id: "class-003" }] });
    await expect(sessions.listAvailable("2026-08-10", "2026-08-11"))
      .resolves.toMatchObject({ sessions: [{ id: "class-001" }, { id: "class-002" }, { id: "class-003" }] });
    await expect(sessions.update({ actorId: "staff-001", auditId: "audit-class-update-001", capacity: 20, classDate: "2026-08-12", classId: "class-001", classTypeId: "type-001", classTypeName: "Cross training", correlationId: "correlation-class-update-001", endsAt: "2026-08-12T23:00:00Z", expectedVersion: 1, startTime: "18:00:00", startsAt: "2026-08-12T22:00:00Z", trainerId: "trainer-003", trainerName: "Entrenadora Tres", updatedAt: "2026-08-08T12:30:00Z" })).resolves.toMatchObject({ capacity: 20, trainerId: "trainer-003", version: 2 });
    await expect(sessions.listByDate("2026-08-10")).resolves.toMatchObject({ sessions: [{ id: "class-002" }] });
    await expect(sessions.listByDate("2026-08-12")).resolves.toMatchObject({ sessions: [{ id: "class-001" }] });
    await expect(sessions.listByTrainer("trainer-003")).resolves.toMatchObject({ sessions: [{ id: "class-001" }] });
    const sessionAudits = await audits.listByEntity("ClassSession", "class-001", "2026-08-08T00:00:00Z", "2026-08-09T00:00:00Z");
    expect(sessionAudits.entries.map(({ action }) => action)).toEqual(["CLASS_SESSION_CREATED", "CLASS_SESSION_UPDATED"]);
  });

  it("allows only one conditional reservation for a class/student pair", async () => {
    const built = reservations.buildConfirmedPut({
      classId: "class-001",
      createdAt: "2026-08-08T13:00:00Z",
      reservationId: "reservation-001",
      startsAt: firstClass.startsAt,
      studentId: "student-001",
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        adapter.transactWrite({ TransactItems: [built.action] })
      ),
    );
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(11);

    await expect(reservations.getForStudent("class-001", "student-001"))
      .resolves.toMatchObject({ id: "reservation-001", status: "CONFIRMED" });
    await expect(reservations.listByClass("class-001", { consistentRead: true }))
      .resolves.toMatchObject({ reservations: [{ id: "reservation-001" }] });
    await expect(reservations.listByStudent("student-001"))
      .resolves.toMatchObject({ reservations: [{ classId: "class-001" }] });
  });

  it("allows at most one reservation when simultaneous attempts compete for one place", async () => {
    const session = await sessions.create({
      ...firstClass,
      auditId: "audit-class-capacity-001",
      capacity: 1,
      classDate: "2026-08-12",
      classId: "class-capacity-001",
      endsAt: "2026-08-12T23:00:00Z",
      startsAt: "2026-08-12T22:00:00Z",
    });
    const capacity = await sessions.prepareReserveCapacityUpdate(
      session.id,
      "2026-08-08T14:00:00Z",
    );
    const reservationActions = ["student-002", "student-003"].map((studentId) =>
      reservations.buildConfirmedPut({
        classId: session.id,
        createdAt: "2026-08-08T14:00:00Z",
        reservationId: `reservation-${studentId}`,
        startsAt: session.startsAt,
        studentId,
      }).action
    );
    const attempts = await Promise.allSettled(
      reservationActions.map((reservationAction) =>
        adapter.transactWrite({
          TransactItems: [capacity.action, reservationAction],
        })
      ),
    );

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await expect(sessions.getById(session.id)).resolves.toMatchObject({
      confirmedCount: 1,
      version: 2,
    });
    await expect(reservations.listByClass(session.id, { consistentRead: true }))
      .resolves.toMatchObject({ reservations: [expect.any(Object)] });
  });

  it("blocks a cancelled session immediately and resumes idempotent reservation batches", async () => {
    let session = await sessions.create({
      ...firstClass,
      auditId: "audit-class-cancel-create",
      capacity: 21,
      classDate: "2026-08-13",
      classId: "class-cancel-001",
      endsAt: "2026-08-13T23:00:00Z",
      startsAt: "2026-08-13T22:00:00Z",
    });
    for (let index = 0; index < 21; index += 1) {
      const studentId = `cancel-student-${String(index).padStart(2, "0")}`;
      const capacity = await sessions.prepareReserveCapacityUpdate(
        session.id,
        "2026-08-08T15:00:00Z",
      );
      const reservation = reservations.buildConfirmedPut({
        classId: session.id,
        createdAt: "2026-08-08T15:00:00Z",
        reservationId: `cancel-reservation-${String(index).padStart(2, "0")}`,
        startsAt: session.startsAt,
        studentId,
      });
      await adapter.transactWrite({
        TransactItems: [capacity.action, reservation.action],
      });
      session = capacity.nextSession;
    }

    const cancelInput = {
      actorId: "staff-001",
      auditId: "audit-class-cancel",
      classId: session.id,
      correlationId: "correlation-class-cancel",
      expectedVersion: session.version,
      reason: "Entrenador no disponible",
      requestKey: "cancel-session-request-001",
      updatedAt: "2026-08-08T15:01:00Z",
    } as const;
    await expect(sessions.cancel(cancelInput)).resolves.toMatchObject({
      confirmedCount: 21,
      status: "CANCELLED",
      version: 23,
    });
    await expect(sessions.listAvailable("2026-08-13", "2026-08-13"))
      .resolves.toMatchObject({ sessions: [] });

    const firstBatch = await sessions.propagateCancellationBatch({
      actorId: "staff-001",
      auditId: "audit-class-cancel-batch-001",
      classId: session.id,
      correlationId: "correlation-class-cancel-batch-001",
      reason: cancelInput.reason,
      requestKey: cancelInput.requestKey,
      updatedAt: "2026-08-08T15:02:00Z",
    });
    expect(firstBatch).toMatchObject({
      cancelledCount: 20,
      complete: false,
      session: { confirmedCount: 1, status: "CANCELLED", version: 24 },
    });
    expect(firstBatch.cursor).toBeDefined();
    if (firstBatch.cursor === undefined) throw new Error("El primer lote debe ser reanudable.");

    const finalBatchInput = {
      actorId: "staff-001",
      auditId: "audit-class-cancel-batch-002",
      classId: session.id,
      correlationId: "correlation-class-cancel-batch-002",
      cursor: firstBatch.cursor,
      reason: cancelInput.reason,
      requestKey: cancelInput.requestKey,
      updatedAt: "2026-08-08T15:03:00Z",
    } as const;
    await expect(sessions.propagateCancellationBatch(finalBatchInput))
      .resolves.toMatchObject({
        cancelledCount: 1,
        complete: true,
        session: { confirmedCount: 0, status: "CANCELLED", version: 25 },
      });
    await expect(sessions.propagateCancellationBatch(finalBatchInput))
      .resolves.toMatchObject({ complete: true, session: { confirmedCount: 0, version: 25 } });
    await expect(sessions.cancel({ ...cancelInput, updatedAt: "2026-08-08T15:04:00Z" }))
      .resolves.toMatchObject({ confirmedCount: 0, status: "CANCELLED", version: 25 });
    const page = await reservations.listByClass(session.id, { consistentRead: true, limit: 25 });
    expect(page.reservations).toHaveLength(21);
    expect(page.reservations.every(({ status }) => status === "ADMIN_CANCELLED")).toBe(true);
    const auditPage = await audits.listByEntity("ClassSession", session.id, "2026-08-08T00:00:00Z", "2026-08-09T00:00:00Z");
    expect(auditPage.entries.map(({ action }) => action)).toEqual([
      "CLASS_SESSION_CREATED",
      "CLASS_SESSION_CANCELLED",
      "CLASS_SESSION_CANCELLATION_BATCH",
      "CLASS_SESSION_CANCELLATION_BATCH",
    ]);
    const resumed = await sessions.cancel({
      ...cancelInput,
      auditId: "audit-class-cancel-resumed",
      expectedVersion: 25,
      requestKey: "cancel-session-request-resumed",
      updatedAt: "2026-08-08T15:05:00Z",
    });
    expect(resumed).toMatchObject({ confirmedCount: 0, status: "CANCELLED", version: 25 });
    await expect(sessions.propagateCancellationBatch({
      actorId: "staff-001",
      auditId: "audit-class-cancel-resumed-batch",
      classId: session.id,
      correlationId: "correlation-class-cancel-resumed",
      reason: cancelInput.reason,
      requestKey: "cancel-session-request-resumed",
      updatedAt: "2026-08-08T15:06:00Z",
    })).resolves.toMatchObject({ cancelledCount: 0, complete: false, session: { version: 25 } });
  });
});
