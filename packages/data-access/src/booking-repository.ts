import type { Reservation } from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { AuditLogRepository } from "./audit-log-repository";
import { ClassSessionRepository } from "./class-session-repository";
import type { DynamoDbDocumentPort, DynamoDbKey } from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
  mapDynamoDbError,
} from "./dynamodb-errors";
import { IdempotencyRepository, type JsonValue } from "./idempotency-repository";
import { primaryKeys } from "./model-keys";
import { ReservationRepository } from "./reservation-repository";
import {
  schedulingId,
  schedulingTableName,
  schedulingTimestamp,
} from "./scheduling-validation";

type TransactionAction = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

export interface CreateBookingInput {
  readonly classId: string;
  readonly createdAt: string;
  readonly requestKey: string;
  readonly reservationId: string;
  readonly studentId: string;
  readonly todayEpochDay: number;
}

export interface BookingMutationResult {
  readonly disposition: "CREATED" | "REPLAYED";
  readonly reservation: Reservation;
}

export interface CancelBookingInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly cancellationWindowMinutes: number;
  readonly cancelledAt: string;
  readonly classId: string;
  readonly correlationId: string;
  readonly requestKey: string;
  readonly settingsVersion: number;
  readonly studentId: string;
}

export interface CancellationMutationResult {
  readonly disposition: "CREATED" | "REPLAYED";
  readonly reservation: Reservation;
}

export interface ReconcileClassCounterInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly classId: string;
  readonly correlationId: string;
  readonly reconciledAt: string;
}

export interface ReconcileClassCounterResult {
  readonly changed: boolean;
  readonly confirmedCount: number;
  readonly previousCount: number;
  readonly version: number;
}

const bookingConflict = (message: string): DynamoDbRepositoryError =>
  new DynamoDbRepositoryError("BOOKING_CONFLICT", message);

export class BookingRepository {
  private readonly audits: AuditLogRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly reservations: ReservationRepository;
  private readonly sessions: ClassSessionRepository;
  private readonly table: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = schedulingTableName(table);
    this.audits = new AuditLogRepository(document, table);
    this.idempotency = new IdempotencyRepository(document, table);
    this.reservations = new ReservationRepository(document, table);
    this.sessions = new ClassSessionRepository(document, table);
  }

  async reserve(input: CreateBookingInput): Promise<BookingMutationResult> {
    const classId = schedulingId(input.classId, "classId");
    const studentId = schedulingId(input.studentId, "studentId");
    const createdAt = schedulingTimestamp(input.createdAt, "createdAt");
    if (!Number.isSafeInteger(input.todayEpochDay)) {
      throw invalidDynamoDbInput("todayEpochDay no es un día válido.");
    }
    const idempotencyInput = {
      operation: "BOOKING",
      payload: { classId, studentId } satisfies JsonValue,
      requestKey: input.requestKey,
      subjectId: studentId,
    } as const;
    const replay = await this.idempotency.findReplay(idempotencyInput);
    if (replay !== undefined) {
      return {
        disposition: "REPLAYED",
        reservation: await this.readReplay(classId, studentId),
      };
    }

    let capacity: Awaited<ReturnType<ClassSessionRepository["prepareReserveCapacityUpdate"]>>;
    try {
      capacity = await this.sessions.prepareReserveCapacityUpdate(classId, createdAt);
    } catch (error) {
      if (
        error instanceof DynamoDbRepositoryError &&
        (error.code === "INVALID_INPUT" || error.code === "CLASS_SESSION_CONFLICT")
      ) {
        throw bookingConflict("La sesión no tiene cupos reservables.");
      }
      throw error;
    }
    const confirmed = this.reservations.buildConfirmedPut({
      classId,
      createdAt,
      reservationId: input.reservationId,
      startsAt: capacity.nextSession.startsAt,
      studentId,
    });
    const actions: readonly TransactionAction[] = [
      capacity.action,
      {
        ConditionCheck: {
          ConditionExpression:
            "attribute_exists(#pk) AND #entityType = :profile AND #status = :active AND contains(#roles, :student)",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
            "#pk": "PK",
            "#roles": "roles",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":active": "ACTIVE",
            ":profile": "UserProfile",
            ":student": "STUDENT",
          },
          Key: primaryKeys.userProfile(studentId),
          TableName: this.table,
        },
      },
      {
        ConditionCheck: {
          ConditionExpression:
            "attribute_exists(#pk) AND #entityType = :pointer AND #status = :active AND #startEpochDay <= :today AND #endEpochDay >= :today",
          ExpressionAttributeNames: {
            "#endEpochDay": "endEpochDay",
            "#entityType": "entityType",
            "#pk": "PK",
            "#startEpochDay": "startEpochDay",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":active": "ACTIVE",
            ":pointer": "ActiveMembershipPointer",
            ":today": input.todayEpochDay,
          },
          Key: primaryKeys.activeMembership(studentId),
          TableName: this.table,
        },
      },
      confirmed.action,
    ];

    try {
      const result = await this.idempotency.transactOrReplay(
        {
          ...idempotencyInput,
          createdAt,
          result: { classId, reservationId: confirmed.reservation.id, studentId },
          retention: { kind: "DURABLE" },
        },
        actions,
      );
      return {
        disposition: result.disposition,
        reservation: result.disposition === "CREATED"
          ? confirmed.reservation
          : await this.readReplay(classId, studentId),
      };
    } catch (error) {
      if (
        error instanceof DynamoDbRepositoryError &&
        (error.code === "TRANSACTION_CANCELLED" ||
          error.code === "CONDITIONAL_CHECK_FAILED")
      ) {
        throw bookingConflict("La reserva no cumple las condiciones vigentes.");
      }
      throw error;
    }
  }

  async cancel(input: CancelBookingInput): Promise<CancellationMutationResult> {
    const classId = schedulingId(input.classId, "classId");
    const studentId = schedulingId(input.studentId, "studentId");
    const actorId = schedulingId(input.actorId, "actorId");
    const cancelledAt = schedulingTimestamp(input.cancelledAt, "cancelledAt");
    if (
      actorId !== studentId ||
      !Number.isSafeInteger(input.cancellationWindowMinutes) ||
      input.cancellationWindowMinutes < 1 ||
      input.cancellationWindowMinutes > 10_080 ||
      !Number.isSafeInteger(input.settingsVersion) ||
      input.settingsVersion < 1
    ) {
      throw invalidDynamoDbInput("Los datos de cancelación de reserva no son válidos.");
    }
    const idempotencyInput = {
      operation: "CANCEL_BOOKING",
      payload: { classId, studentId } satisfies JsonValue,
      requestKey: input.requestKey,
      subjectId: studentId,
    } as const;
    const replay = await this.idempotency.findReplay(idempotencyInput);
    if (replay !== undefined) {
      return { disposition: "REPLAYED", reservation: await this.readCancellationReplay(classId, studentId) };
    }
    const reservation = await this.reservations.getForStudent(classId, studentId);
    if (reservation === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La reserva solicitada no existe.");
    }
    if (reservation.status === "CANCELLED") {
      await this.idempotency.recordOrReplay({
        ...idempotencyInput,
        createdAt: cancelledAt,
        result: { classId, reservationId: reservation.id, studentId },
        retention: { kind: "DURABLE" },
      });
      return { disposition: "REPLAYED", reservation };
    }
    if (reservation.status !== "CONFIRMED") {
      throw bookingConflict("La reserva ya no puede ser cancelada por el alumno.");
    }
    const latestCancellation = Date.parse(reservation.startsAt) - input.cancellationWindowMinutes * 60_000;
    if (Date.parse(cancelledAt) > latestCancellation) {
      throw bookingConflict("El plazo de cancelación de la reserva ya finalizó.");
    }
    const session = await this.sessions.getById(classId, true);
    if (session === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La sesión solicitada no existe.");
    }
    const capacity = this.sessions.buildCancelCapacityUpdate(session, cancelledAt);
    const cancellation = this.reservations.buildStudentCancellation(reservation, cancelledAt);
    const audit = this.audits.createAppendAction({
      action: "RESERVATION_CANCELLED",
      actorId,
      auditId: input.auditId,
      correlationId: input.correlationId,
      details: { classId, previousVersion: reservation.version, version: cancellation.reservation.version },
      result: "SUCCEEDED",
      targetId: reservation.id,
      targetType: "Reservation",
      timestamp: cancelledAt,
    }).action;
    const actions: readonly TransactionAction[] = [
      capacity.action,
      cancellation.action,
      {
        ConditionCheck: {
          ConditionExpression: "attribute_exists(#pk) AND #entityType = :settings AND #version = :expectedVersion AND #window = :expectedWindow",
          ExpressionAttributeNames: { "#entityType": "entityType", "#pk": "PK", "#version": "version", "#window": "cancellationWindowMinutes" },
          ExpressionAttributeValues: { ":expectedVersion": input.settingsVersion, ":expectedWindow": input.cancellationWindowMinutes, ":settings": "GymSettings" },
          Key: primaryKeys.gymSettings(),
          TableName: this.table,
        },
      },
      audit,
    ];
    try {
      const result = await this.idempotency.transactOrReplay({
        ...idempotencyInput,
        createdAt: cancelledAt,
        result: { classId, reservationId: reservation.id, studentId },
        retention: { kind: "DURABLE" },
      }, actions);
      return {
        disposition: result.disposition,
        reservation: result.disposition === "CREATED"
          ? cancellation.reservation
          : await this.readCancellationReplay(classId, studentId),
      };
    } catch (error) {
      if (
        error instanceof DynamoDbRepositoryError &&
        (error.code === "TRANSACTION_CANCELLED" || error.code === "CONDITIONAL_CHECK_FAILED")
      ) {
        throw bookingConflict("La reserva cambió o ya no puede cancelarse.");
      }
      throw error;
    }
  }

  async reconcileClassCounter(
    input: ReconcileClassCounterInput,
  ): Promise<ReconcileClassCounterResult> {
    const classId = schedulingId(input.classId, "classId");
    const reconciledAt = schedulingTimestamp(input.reconciledAt, "reconciledAt");
    const current = await this.sessions.getById(classId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La sesión solicitada no existe.");
    }
    let cursor: DynamoDbKey | undefined;
    let confirmedCount = 0;
    const seenCursors = new Set<string>();
    do {
      const page = await this.reservations.listByClass(classId, {
        consistentRead: true,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 100,
      });
      confirmedCount += page.reservations.filter(({ status }) => status === "CONFIRMED").length;
      cursor = page.cursor;
      if (cursor !== undefined) {
        const marker = JSON.stringify(cursor);
        if (seenCursors.has(marker)) {
          throw new DynamoDbRepositoryError("RESERVATION_RECORD_INVALID", "La paginación de reservas no avanzó.");
        }
        seenCursors.add(marker);
      }
    } while (cursor !== undefined);
    if (confirmedCount === current.confirmedCount) {
      return { changed: false, confirmedCount, previousCount: current.confirmedCount, version: current.version };
    }
    const repair = this.sessions.buildCounterRepair(current, confirmedCount, reconciledAt);
    const audit = this.audits.createAppendAction({
      action: "CLASS_SESSION_COUNTER_RECONCILED",
      actorId: input.actorId,
      auditId: input.auditId,
      correlationId: input.correlationId,
      details: { confirmedCount, previousCount: current.confirmedCount, version: repair.nextSession.version },
      result: "SUCCEEDED",
      targetId: classId,
      targetType: "ClassSession",
      timestamp: reconciledAt,
    }).action;
    try {
      await this.document.transactWrite({ TransactItems: [repair.action, audit] });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") {
        throw new DynamoDbRepositoryError("CLASS_SESSION_CONFLICT", "La sesión cambió durante la reconciliación.");
      }
      throw mapped;
    }
    return {
      changed: true,
      confirmedCount,
      previousCount: current.confirmedCount,
      version: repair.nextSession.version,
    };
  }

  destroy(): void {
    this.sessions.destroy();
  }

  private async readReplay(
    classId: string,
    studentId: string,
  ): Promise<Reservation> {
    const reservation = await this.reservations.getForStudent(classId, studentId);
    if (reservation?.status !== "CONFIRMED") {
      throw new DynamoDbRepositoryError(
        "IDEMPOTENCY_RECORD_INVALID",
        "La reserva idempotente no tiene un resultado canónico confirmado.",
      );
    }
    return reservation;
  }

  private async readCancellationReplay(
    classId: string,
    studentId: string,
  ): Promise<Reservation> {
    const reservation = await this.reservations.getForStudent(classId, studentId);
    if (reservation?.status !== "CANCELLED") {
      throw new DynamoDbRepositoryError(
        "IDEMPOTENCY_RECORD_INVALID",
        "La cancelación idempotente no tiene un resultado canónico.",
      );
    }
    return reservation;
  }
}
