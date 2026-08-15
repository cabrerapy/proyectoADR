import {
  CLASS_SESSION_STATUSES,
  type ClassSession,
  type ClassSessionStatus,
} from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { BaseDynamoDbRepository } from "./base-repository";
import { AuditLogRepository } from "./audit-log-repository";
import type {
  DynamoDbDocumentPort,
  DynamoDbItem,
  DynamoDbKey,
} from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
  mapDynamoDbError,
} from "./dynamodb-errors";
import { hashIdempotencyPayload, IdempotencyRepository } from "./idempotency-repository";
import { operationalIndexKeys, primaryKeys, relationshipIndexKeys } from "./model-keys";
import { SHARDS, shardForId, type Shard } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";
import {
  readSchedulingNumber,
  schedulingCapacity,
  schedulingDate,
  schedulingId,
  schedulingTableName,
  schedulingText,
  schedulingTime,
  schedulingTimestamp,
} from "./scheduling-validation";
import { ReservationRepository } from "./reservation-repository";

type TransactionAction = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

export type SchedulingFanOutCursors = Readonly<
  Record<string, DynamoDbKey | undefined>
>;

export interface CreateClassSessionInput {
  readonly auditId: string;
  readonly capacity: number;
  readonly classDate: string;
  readonly classId: string;
  readonly classTypeId: string;
  readonly classTypeName: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly correlationId: string;
  readonly endsAt: string;
  readonly startTime: string;
  readonly startsAt: string;
  readonly trainerId: string;
  readonly trainerName: string;
}

export interface UpdateClassSessionInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly capacity: number;
  readonly classDate: string;
  readonly classId: string;
  readonly classTypeId: string;
  readonly classTypeName: string;
  readonly correlationId: string;
  readonly endsAt: string;
  readonly expectedVersion: number;
  readonly startTime: string;
  readonly startsAt: string;
  readonly trainerId: string;
  readonly trainerName: string;
  readonly updatedAt: string;
}

export interface CancelClassSessionInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly classId: string;
  readonly correlationId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly requestKey: string;
  readonly updatedAt: string;
}

export interface PropagateClassCancellationInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly classId: string;
  readonly correlationId: string;
  readonly cursor?: DynamoDbKey;
  readonly reason: string;
  readonly requestKey: string;
  readonly updatedAt: string;
}

export interface ClassCancellationBatch {
  readonly cancelledCount: number;
  readonly complete: boolean;
  readonly cursor?: DynamoDbKey;
  readonly session: ClassSession;
}

export interface ClassSessionPage {
  readonly cursors?: SchedulingFanOutCursors;
  readonly sessions: readonly ClassSession[];
}

export interface ReserveCapacityUpdate {
  readonly action: TransactionAction;
  readonly nextSession: ClassSession;
}

export interface CancelCapacityUpdate {
  readonly action: TransactionAction;
  readonly nextSession: ClassSession;
}

export interface CounterRepairUpdate {
  readonly action: TransactionAction;
  readonly nextSession: ClassSession;
}

interface ClassSessionItem extends DynamoDbItem {
  readonly GSI1PK: string;
  readonly GSI1SK: string;
  readonly GSI2PK: string;
  readonly GSI2SK: string;
  readonly capacity: number;
  readonly classDate: string;
  readonly classId: string;
  readonly classTypeId: string;
  readonly classTypeName: string;
  readonly confirmedCount: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly endsAt: string;
  readonly entityType: "ClassSession";
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly startTime: string;
  readonly startsAt: string;
  readonly status: ClassSessionStatus;
  readonly trainerId: string;
  readonly trainerName: string;
  readonly updatedAt: string;
  readonly version: number;
}

const classError = (
  code: "CLASS_SESSION_CONFLICT" | "CLASS_SESSION_RECORD_INVALID",
  message: string,
): DynamoDbRepositoryError => new DynamoDbRepositoryError(code, message);

const isClassStatus = (value: unknown): value is ClassSessionStatus =>
  typeof value === "string" &&
  CLASS_SESSION_STATUSES.some((status) => status === value);

const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw classError(
      "CLASS_SESSION_RECORD_INVALID",
      "La clave persistida de sesión no es válida.",
    );
  }
  return { PK: item.PK, SK: item.SK };
};

const hasCursors = (cursors: SchedulingFanOutCursors): boolean =>
  Object.values(cursors).some((cursor) => cursor !== undefined);

const dateRange = (from: string, to: string): readonly string[] => {
  const start = schedulingDate(from, "fromDate");
  const end = schedulingDate(to, "toDate");
  if (end < start) {
    throw invalidDynamoDbInput("El periodo de clases no es válido.");
  }
  const startEpoch = Date.parse(`${start}T00:00:00Z`);
  const endEpoch = Date.parse(`${end}T00:00:00Z`);
  const days = Math.floor((endEpoch - startEpoch) / 86_400_000) + 1;
  if (days > 31) {
    throw invalidDynamoDbInput("El periodo de clases no puede exceder 31 días.");
  }
  return Array.from({ length: days }, (_, index) =>
    new Date(startEpoch + index * 86_400_000).toISOString().slice(0, 10)
  );
};

export class ClassSessionRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = schedulingTableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async create(input: CreateClassSessionInput): Promise<ClassSession> {
    const session = this.validateCreate(input);
    const key = primaryKeys.classSession(session.id);
    const actions: TransactionAction[] = [
      this.activeReferenceCheck(primaryKeys.trainer(session.trainerId), "Trainer"),
      this.activeReferenceCheck(primaryKeys.classType(session.classTypeId), "ClassType"),
      {
        Put: {
          ConditionExpression:
            "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
          ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
          Item: this.toItem(session, key),
          TableName: this.table,
        },
      },
      this.auditAction(session, input.auditId, input.correlationId, "CLASS_SESSION_CREATED", session.createdBy),
    ];
    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code === "TRANSACTION_CANCELLED" ||
        mapped.code === "CONDITIONAL_CHECK_FAILED"
      ) {
        throw classError(
          "CLASS_SESSION_CONFLICT",
          "La sesión no pudo crearse porque una referencia o condición cambió.",
        );
      }
      throw mapped;
    }
    return session;
  }

  async update(input: UpdateClassSessionInput): Promise<ClassSession> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw invalidDynamoDbInput("La versión esperada no es válida.");
    const current = await this.getById(input.classId, true);
    if (current === undefined) throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La sesión solicitada no existe.");
    if (current.status !== "SCHEDULED" || current.version !== input.expectedVersion) throw classError("CLASS_SESSION_CONFLICT", "La sesión cambió o ya no puede editarse.");
    const next = this.validatePersisted({
      ...input,
      confirmedCount: current.confirmedCount,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
      status: current.status,
      version: current.version + 1,
    });
    const key = primaryKeys.classSession(current.id);
    const actions: TransactionAction[] = [
      this.activeReferenceCheck(primaryKeys.trainer(next.trainerId), "Trainer"),
      this.activeReferenceCheck(primaryKeys.classType(next.classTypeId), "ClassType"),
      {
        Put: {
          ConditionExpression: "attribute_exists(#pk) AND #status = :scheduled AND #version = :expectedVersion AND #confirmedCount <= :capacity",
          ExpressionAttributeNames: { "#confirmedCount": "confirmedCount", "#pk": "PK", "#status": "status", "#version": "version" },
          ExpressionAttributeValues: { ":capacity": next.capacity, ":expectedVersion": input.expectedVersion, ":scheduled": "SCHEDULED" },
          Item: this.toItem(next, key),
          TableName: this.table,
        },
      },
      this.auditAction(next, input.auditId, input.correlationId, "CLASS_SESSION_UPDATED", input.actorId),
    ];
    try { await this.document.transactWrite({ TransactItems: actions }); } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") throw classError("CLASS_SESSION_CONFLICT", "La sesión no pudo editarse porque una referencia, capacidad o versión cambió.");
      throw mapped;
    }
    return next;
  }

  async cancel(input: CancelClassSessionInput): Promise<ClassSession> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw invalidDynamoDbInput("La versión esperada no es válida.");
    }
    const current = await this.getById(input.classId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La sesión solicitada no existe.");
    }
    const reason = schedulingText(input.reason, "reason", 500);
    if (reason.length < 8) {
      throw invalidDynamoDbInput("El motivo debe contener al menos 8 caracteres.");
    }
    const updatedAt = schedulingTimestamp(input.updatedAt, "updatedAt");
    if (current.status === "COMPLETED") {
      throw classError("CLASS_SESSION_CONFLICT", "Una sesión completada no puede cancelarse.");
    }
    const resuming = current.status === "CANCELLED";
    const next = resuming ? current : this.validatePersisted({
      ...current,
      classId: current.id,
      status: "CANCELLED",
      updatedAt,
      version: input.expectedVersion + 1,
    });
    const key = primaryKeys.classSession(current.id);
    await new IdempotencyRepository(this.document, this.table).transactOrReplay({
      createdAt: updatedAt,
      operation: "CANCEL_CLASS_SESSION",
      payload: { actorId: input.actorId, expectedVersion: input.expectedVersion, reason },
      requestKey: input.requestKey,
      result: { classId: current.id, status: "CANCELLED", version: next.version },
      retention: { kind: "DURABLE" },
      subjectId: current.id,
    }, [
      {
        Put: {
          ConditionExpression: resuming
            ? "attribute_exists(#pk) AND #status = :cancelled AND #version = :expectedVersion"
            : "attribute_exists(#pk) AND #status = :scheduled AND #version = :expectedVersion",
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#status": "status",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":expectedVersion": input.expectedVersion,
            ...(resuming ? { ":cancelled": "CANCELLED" } : { ":scheduled": "SCHEDULED" }),
          },
          Item: this.toItem(next, key),
          TableName: this.table,
        },
      },
      this.auditAction(next, input.auditId, input.correlationId, resuming ? "CLASS_SESSION_CANCELLATION_RESUMED" : "CLASS_SESSION_CANCELLED", input.actorId, { reason }),
    ]);
    const persisted = await this.getById(current.id, true);
    if (persisted === undefined || persisted.status !== "CANCELLED") {
      throw classError("CLASS_SESSION_CONFLICT", "La cancelación de la sesión no pudo confirmarse.");
    }
    return persisted;
  }

  async propagateCancellationBatch(
    input: PropagateClassCancellationInput,
  ): Promise<ClassCancellationBatch> {
    const reason = schedulingText(input.reason, "reason", 500);
    const updatedAt = schedulingTimestamp(input.updatedAt, "updatedAt");
    const current = await this.getById(input.classId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La sesión solicitada no existe.");
    }
    if (current.status !== "CANCELLED") {
      throw classError("CLASS_SESSION_CONFLICT", "La sesión debe estar cancelada antes de propagar reservas.");
    }
    const reservations = new ReservationRepository(this.document, this.table);
    const page = await reservations.listByClass(current.id, {
      consistentRead: true,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: 20,
    });
    const confirmed = page.reservations.filter(({ status }) => status === "CONFIRMED");
    const actions = confirmed.map((reservation) =>
      reservations.buildAdminCancellation(reservation, updatedAt).action
    );
    let nextSession = current;
    if (confirmed.length > 0) {
      nextSession = {
        ...current,
        confirmedCount: current.confirmedCount - confirmed.length,
        updatedAt,
        version: current.version + 1,
      };
      if (nextSession.confirmedCount < 0) {
        throw classError("CLASS_SESSION_CONFLICT", "El contador confirmado no admite este lote.");
      }
      actions.push({
        Update: {
          ConditionExpression:
            "attribute_exists(#pk) AND #status = :cancelled AND #version = :expectedVersion AND #confirmedCount = :expectedCount AND #confirmedCount >= :batchCount",
          ExpressionAttributeNames: {
            "#confirmedCount": "confirmedCount",
            "#pk": "PK",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":batchCount": confirmed.length,
            ":cancelled": "CANCELLED",
            ":expectedCount": current.confirmedCount,
            ":expectedVersion": current.version,
            ":nextCount": nextSession.confirmedCount,
            ":nextVersion": nextSession.version,
            ":updatedAt": updatedAt,
          },
          Key: primaryKeys.classSession(current.id),
          TableName: this.table,
          UpdateExpression:
            "SET #confirmedCount = :nextCount, #updatedAt = :updatedAt, #version = :nextVersion",
        },
      });
    }
    actions.push(this.auditAction(nextSession, input.auditId, input.correlationId, "CLASS_SESSION_CANCELLATION_BATCH", input.actorId, { cancelledCount: confirmed.length, reason }));
    const batchKey = hashIdempotencyPayload({
      cursor: input.cursor === undefined ? null : JSON.stringify(input.cursor),
      requestKey: input.requestKey,
    });
    await new IdempotencyRepository(this.document, this.table).transactOrReplay({
      createdAt: updatedAt,
      operation: "PROPAGATE_CLASS_CANCELLATION",
      payload: { actorId: input.actorId, batchKey, classId: current.id, reason },
      requestKey: batchKey,
      result: { cancelledCount: confirmed.length, complete: page.cursor === undefined },
      retention: { kind: "DURABLE" },
      subjectId: current.id,
    }, actions);
    const persisted = await this.getById(current.id, true);
    if (persisted === undefined || persisted.status !== "CANCELLED") {
      throw classError("CLASS_SESSION_CONFLICT", "El lote de cancelación no pudo confirmarse.");
    }
    return {
      cancelledCount: confirmed.length,
      complete: page.cursor === undefined,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      session: persisted,
    };
  }

  async prepareReserveCapacityUpdate(
    classId: string,
    updatedAtInput: string,
  ): Promise<ReserveCapacityUpdate> {
    const current = await this.getById(classId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError(
        "RESOURCE_NOT_FOUND",
        "La sesión solicitada no existe.",
      );
    }
    if (
      current.status !== "SCHEDULED" ||
      current.confirmedCount >= current.capacity
    ) {
      throw invalidDynamoDbInput("La sesión no tiene cupos reservables.");
    }
    const updatedAt = schedulingTimestamp(updatedAtInput, "updatedAt");
    if (updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a la sesión.");
    }
    const nextSession: ClassSession = {
      ...current,
      confirmedCount: current.confirmedCount + 1,
      updatedAt,
      version: current.version + 1,
    };
    const nextIndexes = this.indexes(nextSession);
    return {
      action: {
        Update: {
          ConditionExpression:
            "attribute_exists(#pk) AND #status = :scheduled AND #version = :expectedVersion AND #confirmedCount = :expectedCount AND #confirmedCount < #capacity",
          ExpressionAttributeNames: {
            "#capacity": "capacity",
            "#confirmedCount": "confirmedCount",
            "#gsi1pk": "GSI1PK",
            "#gsi1sk": "GSI1SK",
            "#pk": "PK",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":expectedCount": current.confirmedCount,
            ":expectedVersion": current.version,
            ":gsi1pk": nextIndexes.GSI1PK,
            ":gsi1sk": nextIndexes.GSI1SK,
            ":nextCount": nextSession.confirmedCount,
            ":nextVersion": nextSession.version,
            ":scheduled": "SCHEDULED",
            ":updatedAt": updatedAt,
          },
          Key: primaryKeys.classSession(current.id),
          TableName: this.table,
          UpdateExpression:
            "SET #confirmedCount = :nextCount, #version = :nextVersion, #updatedAt = :updatedAt, #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk",
        },
      },
      nextSession,
    };
  }

  buildCancelCapacityUpdate(
    current: ClassSession,
    updatedAtInput: string,
  ): CancelCapacityUpdate {
    if (current.status !== "SCHEDULED" || current.confirmedCount < 1) {
      throw classError("CLASS_SESSION_CONFLICT", "La sesión no admite cancelar una reserva confirmada.");
    }
    const updatedAt = schedulingTimestamp(updatedAtInput, "updatedAt");
    if (updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a la sesión.");
    }
    const nextSession: ClassSession = {
      ...current,
      confirmedCount: current.confirmedCount - 1,
      updatedAt,
      version: current.version + 1,
    };
    const nextIndexes = this.indexes(nextSession);
    return {
      action: {
        Update: {
          ConditionExpression:
            "attribute_exists(#pk) AND #status = :scheduled AND #version = :expectedVersion AND #confirmedCount = :expectedCount AND #confirmedCount > :zero",
          ExpressionAttributeNames: {
            "#confirmedCount": "confirmedCount",
            "#gsi1pk": "GSI1PK",
            "#gsi1sk": "GSI1SK",
            "#pk": "PK",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":expectedCount": current.confirmedCount,
            ":expectedVersion": current.version,
            ":gsi1pk": nextIndexes.GSI1PK,
            ":gsi1sk": nextIndexes.GSI1SK,
            ":nextCount": nextSession.confirmedCount,
            ":nextVersion": nextSession.version,
            ":scheduled": "SCHEDULED",
            ":updatedAt": updatedAt,
            ":zero": 0,
          },
          Key: primaryKeys.classSession(current.id),
          TableName: this.table,
          UpdateExpression:
            "SET #confirmedCount = :nextCount, #version = :nextVersion, #updatedAt = :updatedAt, #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk",
        },
      },
      nextSession,
    };
  }

  buildCounterRepair(
    current: ClassSession,
    confirmedCount: number,
    updatedAtInput: string,
  ): CounterRepairUpdate {
    if (
      !Number.isSafeInteger(confirmedCount) ||
      confirmedCount < 0 ||
      confirmedCount > current.capacity ||
      confirmedCount === current.confirmedCount
    ) {
      throw invalidDynamoDbInput("El contador de reconciliación no es válido o no requiere ajuste.");
    }
    const updatedAt = schedulingTimestamp(updatedAtInput, "updatedAt");
    if (updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a la sesión.");
    }
    const nextSession: ClassSession = {
      ...current,
      confirmedCount,
      updatedAt,
      version: current.version + 1,
    };
    return {
      action: {
        Put: {
          ConditionExpression:
            "attribute_exists(#pk) AND #version = :expectedVersion AND #confirmedCount = :expectedCount",
          ExpressionAttributeNames: {
            "#confirmedCount": "confirmedCount",
            "#pk": "PK",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":expectedCount": current.confirmedCount,
            ":expectedVersion": current.version,
          },
          Item: this.toItem(nextSession, primaryKeys.classSession(current.id)),
          TableName: this.table,
        },
      },
      nextSession,
    };
  }

  destroy(): void {
    this.base.destroy();
  }

  async getById(
    classId: string,
    consistentRead = true,
  ): Promise<ClassSession | undefined> {
    const key = primaryKeys.classSession(schedulingId(classId, "classId"));
    const item = await this.base.get(key, consistentRead);
    return item === undefined ? undefined : this.readSession(item, key);
  }

  async listByDate(
    date: string,
    options: {
      readonly cursors?: SchedulingFanOutCursors;
      readonly limitPerShard?: number;
    } = {},
  ): Promise<ClassSessionPage> {
    const classDate = schedulingDate(date, "classDate");
    return this.listByDatePartitions(
      [classDate],
      options,
      undefined,
      (session) => session.classDate === classDate,
    );
  }

  async listAvailable(
    fromDate: string,
    toDate: string,
    options: {
      readonly cursors?: SchedulingFanOutCursors;
      readonly limitPerPartition?: number;
    } = {},
  ): Promise<ClassSessionPage> {
    const dates = dateRange(fromDate, toDate);
    return this.listByDatePartitions(
      dates,
      {
        ...(options.cursors === undefined ? {} : { cursors: options.cursors }),
        ...(options.limitPerPartition === undefined
          ? {}
          : { limitPerShard: options.limitPerPartition }),
      },
      "AVAILABLE#",
      (session) =>
        dates.includes(session.classDate) &&
        session.status === "SCHEDULED" &&
        session.confirmedCount < session.capacity,
    );
  }

  async listByTrainer(
    trainerId: string,
    options: {
      readonly cursor?: DynamoDbKey;
      readonly from?: string;
      readonly limit?: number;
      readonly to?: string;
    } = {},
  ): Promise<{ readonly cursor?: DynamoDbKey; readonly sessions: readonly ClassSession[] }> {
    const id = schedulingId(trainerId, "trainerId");
    const from = options.from === undefined
      ? "0000-00-00T00:00:00Z"
      : schedulingTimestamp(options.from, "from");
    const to = options.to === undefined
      ? "9999-12-31T23:59:59.999Z"
      : schedulingTimestamp(options.to, "to");
    if (to < from) {
      throw invalidDynamoDbInput("El rango del entrenador no es válido.");
    }
    const page = await this.base.queryPage({
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      indexName: "GSI2-Relationships",
      limit: options.limit ?? 25,
      partitionValue: `TRAINER#${id}`,
      sortKey: {
        from: `START#${from}#`,
        operation: "BETWEEN",
        to: `START#${to}#\uffff`,
      },
    });
    const sessions = await this.readSessions(page.items.map(itemKey));
    return {
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      sessions: sessions
        .filter((session) => session.trainerId === id)
        .sort(sessionOrder),
    };
  }

  private activeReferenceCheck(
    key: PrimaryKey,
    entityType: "ClassType" | "Trainer",
  ): TransactionAction {
    return {
      ConditionCheck: {
        ConditionExpression:
          "attribute_exists(#pk) AND #entityType = :entityType AND #status = :active",
        ExpressionAttributeNames: {
          "#entityType": "entityType",
          "#pk": "PK",
          "#status": "status",
        },
        ExpressionAttributeValues: { ":active": "ACTIVE", ":entityType": entityType },
        Key: key,
        TableName: this.table,
      },
    };
  }

  private auditAction(session: ClassSession, auditId: string, correlationId: string, action: string, actorId: string, extraDetails: Readonly<Record<string, number | string>> = {}): TransactionAction {
    return new AuditLogRepository(this.document, this.table).createAppendAction({
      action,
      actorId,
      auditId,
      correlationId,
      details: { capacity: session.capacity, classTypeId: session.classTypeId, startsAt: session.startsAt, trainerId: session.trainerId, version: session.version, ...extraDetails },
      result: "SUCCEEDED",
      targetId: session.id,
      targetType: "ClassSession",
      timestamp: session.updatedAt,
    }).action;
  }

  private async listByDatePartitions(
    dates: readonly string[],
    options: {
      readonly cursors?: SchedulingFanOutCursors;
      readonly limitPerShard?: number;
    },
    sortPrefix: string | undefined,
    matches: (session: ClassSession) => boolean,
  ): Promise<ClassSessionPage> {
    const limit = options.limitPerShard ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw invalidDynamoDbInput("El límite por partición debe estar entre 1 y 25.");
    }
    const partitions = dates.flatMap((date) =>
      SHARDS.map((shard) => ({ cursorKey: `${date}:${shard}`, date, shard }))
    );
    const pages = await Promise.all(
      partitions.map(async ({ cursorKey, date, shard }) => ({
        cursorKey,
        page: await this.base.queryPage({
          ...(options.cursors?.[cursorKey] === undefined
            ? {}
            : { cursor: options.cursors[cursorKey] }),
          indexName: "GSI1-Operational",
          limit,
          partitionValue: `CLASS_DATE#${date}#${shard}`,
          ...(sortPrefix === undefined
            ? {}
            : { sortKey: { operation: "BEGINS_WITH" as const, value: sortPrefix } }),
        }),
      })),
    );
    const sessions = (await this.readSessions(
      pages.flatMap(({ page }) => page.items.map(itemKey)),
    ))
      .filter(matches)
      .sort(sessionOrder);
    const cursors = Object.fromEntries(
      pages.map(({ cursorKey, page }) => [cursorKey, page.nextCursor]),
    );
    return {
      ...(hasCursors(cursors) ? { cursors } : {}),
      sessions,
    };
  }

  private async readSessions(keys: readonly PrimaryKey[]): Promise<ClassSession[]> {
    const unique = [...new Map(keys.map((key) => [`${key.PK}\u0000${key.SK}`, key])).values()];
    const sessions: ClassSession[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      if (batch.length === 0) {
        continue;
      }
      sessions.push(
        ...(await this.base.batchGet(batch, true)).map((item) =>
          this.readSession(item, itemKey(item))
        ),
      );
    }
    return sessions;
  }

  private readSession(item: DynamoDbItem, expectedKey: PrimaryKey): ClassSession {
    const capacity = readSchedulingNumber(item.capacity);
    const confirmedCount = readSchedulingNumber(item.confirmedCount);
    const version = readSchedulingNumber(item.version);
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "ClassSession" ||
      readSchedulingNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.classId !== "string" ||
      typeof item.classTypeId !== "string" ||
      typeof item.classTypeName !== "string" ||
      typeof item.trainerId !== "string" ||
      typeof item.trainerName !== "string" ||
      typeof item.classDate !== "string" ||
      typeof item.startTime !== "string" ||
      typeof item.startsAt !== "string" ||
      typeof item.endsAt !== "string" ||
      typeof item.createdBy !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      typeof item.GSI1PK !== "string" ||
      typeof item.GSI1SK !== "string" ||
      typeof item.GSI2PK !== "string" ||
      typeof item.GSI2SK !== "string" ||
      !isClassStatus(item.status) ||
      capacity === undefined ||
      confirmedCount === undefined ||
      version === undefined
    ) {
      throw classError(
        "CLASS_SESSION_RECORD_INVALID",
        "La sesión persistida no es válida.",
      );
    }
    try {
      const session = this.validatePersisted({
        capacity,
        classDate: item.classDate,
        classId: item.classId,
        classTypeId: item.classTypeId,
        classTypeName: item.classTypeName,
        confirmedCount,
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        endsAt: item.endsAt,
        startTime: item.startTime,
        startsAt: item.startsAt,
        status: item.status,
        trainerId: item.trainerId,
        trainerName: item.trainerName,
        updatedAt: item.updatedAt,
        version,
      });
      const expectedIndexes = this.indexes(session);
      if (
        item.GSI1PK !== expectedIndexes.GSI1PK ||
        item.GSI1SK !== expectedIndexes.GSI1SK ||
        item.GSI2PK !== expectedIndexes.GSI2PK ||
        item.GSI2SK !== expectedIndexes.GSI2SK
      ) {
        throw new Error("invalid indexes");
      }
      return session;
    } catch {
      throw classError(
        "CLASS_SESSION_RECORD_INVALID",
        "La sesión persistida no es válida.",
      );
    }
  }

  private indexes(session: ClassSession): {
    readonly GSI1PK: string;
    readonly GSI1SK: string;
    readonly GSI2PK: string;
    readonly GSI2SK: string;
  } {
    const availability = session.status === "SCHEDULED" &&
        session.confirmedCount < session.capacity
      ? "AVAILABLE"
      : "FULL";
    const byDate = operationalIndexKeys.classDate(
      session.classDate,
      shardForId(session.id),
      availability,
      session.startTime,
      session.id,
    );
    const byTrainer = relationshipIndexKeys.sessionsByTrainer(
      session.trainerId,
      session.startsAt,
      session.id,
    );
    return {
      GSI1PK: byDate.PK,
      GSI1SK: byDate.SK,
      GSI2PK: byTrainer.PK,
      GSI2SK: byTrainer.SK,
    };
  }

  private toItem(session: ClassSession, key: PrimaryKey): ClassSessionItem {
    return {
      ...key,
      ...this.indexes(session),
      capacity: session.capacity,
      classDate: session.classDate,
      classId: session.id,
      classTypeId: session.classTypeId,
      classTypeName: session.classTypeName,
      confirmedCount: session.confirmedCount,
      createdAt: session.createdAt,
      createdBy: session.createdBy,
      endsAt: session.endsAt,
      entityType: "ClassSession",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      startTime: session.startTime,
      startsAt: session.startsAt,
      status: session.status,
      trainerId: session.trainerId,
      trainerName: session.trainerName,
      updatedAt: session.updatedAt,
      version: session.version,
    };
  }

  private validateCreate(input: CreateClassSessionInput): ClassSession {
    return this.validatePersisted({
      ...input,
      confirmedCount: 0,
      status: "SCHEDULED",
      updatedAt: input.createdAt,
      version: 1,
    });
  }

  private validatePersisted(input: {
    readonly capacity: number;
    readonly classDate: string;
    readonly classId: string;
    readonly classTypeId: string;
    readonly classTypeName: string;
    readonly confirmedCount: number;
    readonly createdAt: string;
    readonly createdBy: string;
    readonly endsAt: string;
    readonly startTime: string;
    readonly startsAt: string;
    readonly status: ClassSessionStatus;
    readonly trainerId: string;
    readonly trainerName: string;
    readonly updatedAt: string;
    readonly version: number;
  }): ClassSession {
    if (!isClassStatus(input.status)) {
      throw invalidDynamoDbInput("El estado de sesión no es válido.");
    }
    const capacity = schedulingCapacity(input.capacity);
    if (
      !Number.isSafeInteger(input.confirmedCount) ||
      input.confirmedCount < 0 ||
      input.confirmedCount > capacity
    ) {
      throw invalidDynamoDbInput("El contador confirmado no es válido.");
    }
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw invalidDynamoDbInput("La versión de sesión no es válida.");
    }
    const startsAt = schedulingTimestamp(input.startsAt, "startsAt");
    const endsAt = schedulingTimestamp(input.endsAt, "endsAt");
    if (endsAt <= startsAt) {
      throw invalidDynamoDbInput("endsAt debe ser posterior a startsAt.");
    }
    const createdAt = schedulingTimestamp(input.createdAt, "createdAt");
    const updatedAt = schedulingTimestamp(input.updatedAt, "updatedAt");
    if (updatedAt < createdAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a createdAt.");
    }
    return {
      capacity,
      classDate: schedulingDate(input.classDate, "classDate"),
      classTypeId: schedulingId(input.classTypeId, "classTypeId"),
      classTypeName: schedulingText(input.classTypeName, "classTypeName", 120),
      confirmedCount: input.confirmedCount,
      createdAt,
      createdBy: schedulingId(input.createdBy, "createdBy"),
      endsAt,
      id: schedulingId(input.classId, "classId"),
      startTime: schedulingTime(input.startTime, "startTime"),
      startsAt,
      status: input.status,
      trainerId: schedulingId(input.trainerId, "trainerId"),
      trainerName: schedulingText(input.trainerName, "trainerName", 120),
      updatedAt,
      version: input.version,
    };
  }
}

const sessionOrder = (left: ClassSession, right: ClassSession): number =>
  left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id);
