import {
  RESERVATION_STATUSES,
  type Reservation,
  type ReservationStatus,
} from "@gym-adr/domain";

import { BaseDynamoDbRepository } from "./base-repository";
import type {
  DynamoDbDocumentPort,
  DynamoDbItem,
  DynamoDbKey,
} from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
} from "./dynamodb-errors";
import type { TransactionAction } from "./idempotency-repository";
import { primaryKeys, relationshipIndexKeys } from "./model-keys";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";
import {
  readSchedulingNumber,
  schedulingId,
  schedulingTableName,
  schedulingTimestamp,
} from "./scheduling-validation";

export interface BuildConfirmedReservationInput {
  readonly classId: string;
  readonly createdAt: string;
  readonly reservationId: string;
  readonly startsAt: string;
  readonly studentId: string;
}

export interface ConfirmedReservationPut {
  readonly action: TransactionAction;
  readonly reservation: Reservation;
}

interface ReservationItem extends DynamoDbItem {
  readonly GSI2PK: string;
  readonly GSI2SK: string;
  readonly classId: string;
  readonly createdAt: string;
  readonly entityType: "Reservation";
  readonly reservationId: string;
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly startsAt: string;
  readonly status: ReservationStatus;
  readonly studentId: string;
  readonly updatedAt: string;
  readonly version: number;
}

const reservationError = (message: string): DynamoDbRepositoryError =>
  new DynamoDbRepositoryError("RESERVATION_RECORD_INVALID", message);

const isReservationStatus = (value: unknown): value is ReservationStatus =>
  typeof value === "string" &&
  RESERVATION_STATUSES.some((status) => status === value);

const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw reservationError("La clave persistida de reserva no es válida.");
  }
  return { PK: item.PK, SK: item.SK };
};

export class ReservationRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(
    document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = schedulingTableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  buildConfirmedPut(input: BuildConfirmedReservationInput): ConfirmedReservationPut {
    const createdAt = schedulingTimestamp(input.createdAt, "createdAt");
    const reservation: Reservation = {
      classId: schedulingId(input.classId, "classId"),
      createdAt,
      id: schedulingId(input.reservationId, "reservationId"),
      startsAt: schedulingTimestamp(input.startsAt, "startsAt"),
      status: "CONFIRMED",
      studentId: schedulingId(input.studentId, "studentId"),
      updatedAt: createdAt,
      version: 1,
    };
    const key = primaryKeys.reservation(reservation.classId, reservation.studentId);
    return {
      action: {
        Put: {
          ConditionExpression:
            "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
          ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
          Item: this.toItem(reservation, key),
          TableName: this.table,
        },
      },
      reservation,
    };
  }

  destroy(): void {
    this.base.destroy();
  }

  async getForStudent(
    classId: string,
    studentId: string,
  ): Promise<Reservation | undefined> {
    const key = primaryKeys.reservation(
      schedulingId(classId, "classId"),
      schedulingId(studentId, "studentId"),
    );
    const item = await this.base.get(key, true);
    return item === undefined ? undefined : this.readReservation(item, key);
  }

  async listByClass(
    classId: string,
    options: {
      readonly consistentRead?: boolean;
      readonly cursor?: DynamoDbKey;
      readonly limit?: number;
    } = {},
  ): Promise<{ readonly cursor?: DynamoDbKey; readonly reservations: readonly Reservation[] }> {
    const id = schedulingId(classId, "classId");
    const page = await this.base.queryPage({
      consistentRead: options.consistentRead ?? false,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit ?? 25,
      partitionValue: `CLASS#${id}`,
      sortKey: { operation: "BEGINS_WITH", value: "RESERVATION#" },
    });
    return {
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      reservations: page.items
        .map((item) => this.readReservation(item, itemKey(item)))
        .sort(reservationOrder),
    };
  }

  async listByStudent(
    studentId: string,
    options: {
      readonly cursor?: DynamoDbKey;
      readonly from?: string;
      readonly limit?: number;
      readonly to?: string;
    } = {},
  ): Promise<{ readonly cursor?: DynamoDbKey; readonly reservations: readonly Reservation[] }> {
    const id = schedulingId(studentId, "studentId");
    const from = options.from === undefined
      ? "0000-00-00T00:00:00Z"
      : schedulingTimestamp(options.from, "from");
    const to = options.to === undefined
      ? "9999-12-31T23:59:59.999Z"
      : schedulingTimestamp(options.to, "to");
    if (to < from) {
      throw invalidDynamoDbInput("El rango de reservas no es válido.");
    }
    const page = await this.base.queryPage({
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      indexName: "GSI2-Relationships",
      limit: options.limit ?? 25,
      partitionValue: `USER#${id}`,
      sortKey: {
        from: `RESERVATION#${from}#`,
        operation: "BETWEEN",
        to: `RESERVATION#${to}#\uffff`,
      },
    });
    const keys = page.items.map(itemKey);
    const reservations = keys.length === 0
      ? []
      : (await this.base.batchGet(keys, true))
          .map((item) => this.readReservation(item, itemKey(item)))
          .filter((reservation) => reservation.studentId === id)
          .sort(reservationOrder);
    return {
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      reservations,
    };
  }

  private readReservation(item: DynamoDbItem, expectedKey: PrimaryKey): Reservation {
    const schemaVersion = readSchedulingNumber(item.schemaVersion);
    const version = readSchedulingNumber(item.version);
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "Reservation" ||
      schemaVersion !== CURRENT_SCHEMA_VERSION ||
      typeof item.reservationId !== "string" ||
      typeof item.classId !== "string" ||
      typeof item.studentId !== "string" ||
      typeof item.startsAt !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      typeof item.GSI2PK !== "string" ||
      typeof item.GSI2SK !== "string" ||
      !isReservationStatus(item.status) ||
      version === undefined ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw reservationError("La reserva persistida no es válida.");
    }
    try {
      const reservation: Reservation = {
        classId: schedulingId(item.classId, "classId"),
        createdAt: schedulingTimestamp(item.createdAt, "createdAt"),
        id: schedulingId(item.reservationId, "reservationId"),
        startsAt: schedulingTimestamp(item.startsAt, "startsAt"),
        status: item.status,
        studentId: schedulingId(item.studentId, "studentId"),
        updatedAt: schedulingTimestamp(item.updatedAt, "updatedAt"),
        version,
      };
      if (reservation.updatedAt < reservation.createdAt) {
        throw new Error("invalid update timestamp");
      }
      const index = relationshipIndexKeys.reservationByStudent(
        reservation.studentId,
        reservation.startsAt,
        reservation.classId,
      );
      if (item.GSI2PK !== index.PK || item.GSI2SK !== index.SK) {
        throw new Error("invalid index");
      }
      const key = primaryKeys.reservation(
        reservation.classId,
        reservation.studentId,
      );
      if (key.PK !== expectedKey.PK || key.SK !== expectedKey.SK) {
        throw new Error("invalid primary key");
      }
      return reservation;
    } catch {
      throw reservationError("La reserva persistida no es válida.");
    }
  }

  private toItem(reservation: Reservation, key: PrimaryKey): ReservationItem {
    const index = relationshipIndexKeys.reservationByStudent(
      reservation.studentId,
      reservation.startsAt,
      reservation.classId,
    );
    return {
      ...key,
      GSI2PK: index.PK,
      GSI2SK: index.SK,
      classId: reservation.classId,
      createdAt: reservation.createdAt,
      entityType: "Reservation",
      reservationId: reservation.id,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      startsAt: reservation.startsAt,
      status: reservation.status,
      studentId: reservation.studentId,
      updatedAt: reservation.updatedAt,
      version: reservation.version,
    };
  }
}

const reservationOrder = (left: Reservation, right: Reservation): number =>
  left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id);
