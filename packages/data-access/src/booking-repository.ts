import type { Reservation } from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { ClassSessionRepository } from "./class-session-repository";
import type { DynamoDbDocumentPort } from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
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

const bookingConflict = (message: string): DynamoDbRepositoryError =>
  new DynamoDbRepositoryError("BOOKING_CONFLICT", message);

export class BookingRepository {
  private readonly idempotency: IdempotencyRepository;
  private readonly reservations: ReservationRepository;
  private readonly sessions: ClassSessionRepository;
  private readonly table: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = schedulingTableName(table);
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
}
