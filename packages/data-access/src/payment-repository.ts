import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type Payment,
  type PaymentCorrection,
  type PaymentMethod,
  type PaymentStatus,
} from "@gym-adr/domain";

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
import {
  financialAmount,
  financialCurrency,
  financialDate,
  financialId,
  financialText,
  financialTimestamp,
  optionalFinancialText,
  readFiniteNumber,
  tableName,
} from "./financial-validation";
import {
  IdempotencyRepository,
  type IdempotencyResult,
  type JsonValue,
  type TransactionAction,
} from "./idempotency-repository";
import type { MembershipFanOutCursors } from "./membership-repository";
import { operationalIndexKeys, primaryKeys } from "./model-keys";
import { SHARDS, shardForId, type Shard } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";

export interface RecordPaymentInput {
  readonly amount: number;
  readonly auditId: string;
  readonly correlationId: string;
  readonly correction?: {
    readonly expectedOriginalVersion: number;
    readonly originalPaidAt: string;
    readonly originalPaymentId: string;
    readonly reason: string;
    readonly type: "ADJUSTMENT" | "COMPENSATION";
  };
  readonly createdAt: string;
  readonly currency: string;
  readonly membershipId: string;
  readonly membershipStartDate: string;
  readonly method: PaymentMethod;
  readonly notes?: string;
  readonly paidAt: string;
  readonly paymentDate: string;
  readonly paymentId: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly receiptKey?: string;
  readonly recordedBy: string;
  readonly requestKey: string;
  readonly status: Exclude<PaymentStatus, "VOIDED">;
  readonly userId: string;
}

export interface VoidPaymentInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly correctedAt: string;
  readonly correctionId: string;
  readonly expectedVersion: number;
  readonly originalPaidAt: string;
  readonly paymentId: string;
  readonly reason: string;
  readonly requestKey: string;
  readonly userId: string;
}

export interface PaymentMutationResult<T> {
  readonly disposition: "CREATED" | "REPLAYED";
  readonly value: T;
}

export interface PaymentPage {
  readonly cursors?: MembershipFanOutCursors;
  readonly payments: readonly Payment[];
}

interface PaymentItem extends DynamoDbItem {
  readonly amount: number;
  readonly createdAt: string;
  readonly currency: string;
  readonly correctionType?: "ADJUSTMENT" | "COMPENSATION";
  readonly entityType: "Payment";
  readonly membershipId: string;
  readonly method: PaymentMethod;
  readonly notes?: string;
  readonly originalPaymentId?: string;
  readonly paidAt: string;
  readonly paymentDate: string;
  readonly paymentId: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly receiptKey?: string;
  readonly recordedBy: string;
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly status: PaymentStatus;
  readonly updatedAt: string;
  readonly userId: string;
  readonly version: number;
}

const paymentError = (
  code: "PAYMENT_CONFLICT" | "PAYMENT_RECORD_INVALID" | "PAYMENT_STATE_CONFLICT",
  message: string,
): DynamoDbRepositoryError => new DynamoDbRepositoryError(code, message);

const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === "string" && PAYMENT_STATUSES.some((status) => status === value);

const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === "string" && PAYMENT_METHODS.some((method) => method === value);

const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw paymentError(
      "PAYMENT_RECORD_INVALID",
      "La clave persistida de pago no es válida.",
    );
  }
  return { PK: item.PK, SK: item.SK };
};

const putAbsent = (table: string, item: DynamoDbItem): TransactionAction => ({
  Put: {
    ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
    ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
    Item: item,
    TableName: table,
  },
});

export class PaymentRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly table: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
    this.idempotency = new IdempotencyRepository(document, table);
  }

  async record(input: RecordPaymentInput): Promise<PaymentMutationResult<Payment>> {
    const basePayment = this.validatePayment(input);
    const correction = input.correction === undefined ? undefined : {
      expectedOriginalVersion: input.correction.expectedOriginalVersion,
      originalPaidAt: financialTimestamp(input.correction.originalPaidAt, "originalPaidAt"),
      originalPaymentId: financialId(input.correction.originalPaymentId, "originalPaymentId"),
      reason: financialText(input.correction.reason, "reason", 500),
      type: input.correction.type,
    };
    if (correction !== undefined && (!Number.isSafeInteger(correction.expectedOriginalVersion) || correction.expectedOriginalVersion < 1)) throw invalidDynamoDbInput("La versión original no es válida.");
    const payment: Payment = correction === undefined ? basePayment : {
      ...basePayment,
      correctionType: correction.type,
      originalPaymentId: correction.originalPaymentId,
    };
    const membershipStartDate = financialDate(
      input.membershipStartDate,
      "membershipStartDate",
    );
    const key = primaryKeys.payment(payment.userId, payment.paidAt, payment.id);
    const actions: TransactionAction[] = [
      {
        ConditionCheck: {
          ConditionExpression: "attribute_exists(#pk) AND #entityType = :profile",
          ExpressionAttributeNames: { "#entityType": "entityType", "#pk": "PK" },
          ExpressionAttributeValues: { ":profile": "UserProfile" },
          Key: primaryKeys.userProfile(payment.userId),
          TableName: this.table,
        },
      },
      ...(correction === undefined ? [{
        ConditionCheck: {
          ConditionExpression:
            "attribute_exists(#pk) AND #entityType = :membership AND #membershipId = :membershipId",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
            "#membershipId": "membershipId",
            "#pk": "PK",
          },
          ExpressionAttributeValues: {
            ":membership": "Membership",
            ":membershipId": payment.membershipId,
          },
          Key: primaryKeys.membership(
            payment.userId,
            membershipStartDate,
            payment.membershipId,
          ),
          TableName: this.table,
        },
      }] : []),
      ...(correction === undefined ? [] : [{
        ConditionCheck: {
          ConditionExpression: "#status = :confirmed AND #version = :expectedVersion",
          ExpressionAttributeNames: { "#status": "status", "#version": "version" },
          ExpressionAttributeValues: { ":confirmed": "CONFIRMED", ":expectedVersion": correction.expectedOriginalVersion },
          Key: primaryKeys.payment(payment.userId, correction.originalPaidAt, correction.originalPaymentId),
          TableName: this.table,
        },
      }]),
      putAbsent(this.table, this.toItem(payment, key)),
      putAbsent(this.table, this.dateView(payment, key)),
      putAbsent(this.table, this.statusView(payment, key)),
      new AuditLogRepository(this.document, this.table).createAppendAction({
        action: correction === undefined ? "PAYMENT_RECORDED" : `PAYMENT_${correction.type}`,
        actorId: payment.recordedBy,
        auditId: financialId(input.auditId, "auditId"),
        correlationId: financialId(input.correlationId, "correlationId"),
        details: {
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          ...(correction === undefined ? {} : { correctionType: correction.type, originalPaymentId: correction.originalPaymentId }),
          status: payment.status,
        },
        result: "SUCCEEDED",
        targetId: payment.id,
        targetType: "Payment",
        timestamp: payment.createdAt,
      }).action,
      ...(correction === undefined ? [] : [putAbsent(this.table, {
        ...primaryKeys.paymentCorrection(payment.userId, payment.paidAt, payment.id),
        actorId: payment.recordedBy,
        correctedAt: payment.paidAt,
        correctionId: payment.id,
        createdAt: payment.createdAt,
        entityType: "PaymentCorrection",
        originalPaymentId: correction.originalPaymentId,
        reason: correction.reason,
        relatedPaymentId: payment.id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: correction.type,
        updatedAt: payment.updatedAt,
        userId: payment.userId,
      })]),
    ];
    const result = await this.transactPayment(
      {
        createdAt: payment.createdAt,
        operation: "PAYMENT_RECORD",
        payload: this.recordPayload(payment, membershipStartDate, correction),
        requestKey: financialId(input.requestKey, "requestKey"),
        result: { paidAt: payment.paidAt, paymentId: payment.id, userId: payment.userId },
        retention: { kind: "DURABLE" },
        subjectId: payment.recordedBy,
      },
      actions,
    );
    const reference = this.paymentResult(result.result);
    const persisted = await this.getById(reference.userId, reference.paidAt, reference.paymentId);
    if (persisted === undefined) {
      throw paymentError(
        "PAYMENT_RECORD_INVALID",
        "El pago idempotente no tiene un registro canónico.",
      );
    }
    return { disposition: result.disposition, value: persisted };
  }

  async voidConfirmed(
    input: VoidPaymentInput,
  ): Promise<PaymentMutationResult<PaymentCorrection>> {
    const userId = financialId(input.userId, "userId");
    const paymentId = financialId(input.paymentId, "paymentId");
    const paidAt = financialTimestamp(input.originalPaidAt, "originalPaidAt");
    const paymentKey = primaryKeys.payment(userId, paidAt, paymentId);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw invalidDynamoDbInput("La versión esperada del pago no es válida.");
    }
    const correctedAt = financialTimestamp(input.correctedAt, "correctedAt");
    const correction: PaymentCorrection = {
      actorId: financialId(input.actorId, "actorId"),
      correctedAt,
      id: financialId(input.correctionId, "correctionId"),
      originalPaymentId: paymentId,
      reason: financialText(input.reason, "reason", 500),
      type: "VOID",
      userId,
    };
    const correctionKey = primaryKeys.paymentCorrection(
      userId,
      correction.correctedAt,
      correction.id,
    );
    const oldStatusViewKey = primaryKeys.view(
      "Payment",
      paymentId,
      "STATUS_CONFIRMED",
      userId,
    );
    const nextVersion = input.expectedVersion + 1;
    const actions: TransactionAction[] = [
      {
        Update: {
          ConditionExpression:
            "#status = :confirmed AND #version = :expectedVersion AND #updatedAt <= :updatedAt",
          ExpressionAttributeNames: {
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":confirmed": "CONFIRMED",
            ":expectedVersion": input.expectedVersion,
            ":nextVersion": nextVersion,
            ":updatedAt": correctedAt,
            ":voided": "VOIDED",
          },
          Key: paymentKey,
          TableName: this.table,
          UpdateExpression:
            "SET #status = :voided, #updatedAt = :updatedAt, #version = :nextVersion",
        },
      },
      {
        Delete: {
          ConditionExpression: "#canonicalPK = :pk AND #canonicalSK = :sk",
          ExpressionAttributeNames: {
            "#canonicalPK": "canonicalPK",
            "#canonicalSK": "canonicalSK",
          },
          ExpressionAttributeValues: { ":pk": paymentKey.PK, ":sk": paymentKey.SK },
          Key: oldStatusViewKey,
          TableName: this.table,
        },
      },
      putAbsent(
        this.table,
        this.statusViewFromReference({
          canonicalKey: paymentKey,
          createdAt: correctedAt,
          paidAt,
          paymentId,
          status: "VOIDED",
          updatedAt: correctedAt,
          userId,
        }),
      ),
      putAbsent(this.table, {
        ...correctionKey,
        actorId: correction.actorId,
        correctedAt: correction.correctedAt,
        correctionId: correction.id,
        createdAt: correction.correctedAt,
        entityType: "PaymentCorrection",
        originalPaymentId: correction.originalPaymentId,
        reason: correction.reason,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: correction.type,
        updatedAt: correction.correctedAt,
        userId: correction.userId,
      }),
      new AuditLogRepository(this.document, this.table).createAppendAction({
        action: "PAYMENT_VOIDED",
        actorId: correction.actorId,
        auditId: financialId(input.auditId, "auditId"),
        correlationId: financialId(input.correlationId, "correlationId"),
        details: { originalPaymentId: paymentId, reason: correction.reason },
        result: "SUCCEEDED",
        targetId: paymentId,
        targetType: "Payment",
        timestamp: correctedAt,
      }).action,
    ];
    const disposition = await this.transactPayment(
      {
        createdAt: correctedAt,
        operation: "PAYMENT_VOID",
        payload: {
          actorId: correction.actorId,
          expectedVersion: input.expectedVersion,
          originalPaidAt: paidAt,
          paymentId,
          reason: correction.reason,
          userId,
        },
        requestKey: financialId(input.requestKey, "requestKey"),
        result: {
          correctedAt,
          correctionId: correction.id,
          paymentId,
          userId,
        },
        retention: { kind: "DURABLE" },
        subjectId: correction.actorId,
      },
      actions,
    );
    const reference = this.correctionResult(disposition.result);
    const persistedKey = primaryKeys.paymentCorrection(reference.userId, reference.correctedAt, reference.correctionId);
    const persisted = await this.base.get(persistedKey, true);
    if (persisted === undefined) {
      throw paymentError(
        "PAYMENT_RECORD_INVALID",
        "La corrección idempotente no tiene un registro canónico.",
      );
    }
    return {
      disposition: disposition.disposition,
      value: this.readCorrection(persisted, persistedKey),
    };
  }

  destroy(): void {
    this.base.destroy();
  }

  async getById(
    userId: string,
    paidAt: string,
    paymentId: string,
  ): Promise<Payment | undefined> {
    const key = primaryKeys.payment(
      financialId(userId, "userId"),
      financialTimestamp(paidAt, "paidAt"),
      financialId(paymentId, "paymentId"),
    );
    const item = await this.base.get(key, true);
    return item === undefined ? undefined : this.readPayment(item, key);
  }

  async listHistory(
    userId: string,
    options: {
      readonly consistentRead?: boolean;
      readonly cursor?: DynamoDbKey;
      readonly from?: string;
      readonly limit?: number;
      readonly to?: string;
    } = {},
  ): Promise<{ readonly cursor?: DynamoDbKey; readonly payments: readonly Payment[] }> {
    const id = financialId(userId, "userId");
    const from = options.from === undefined
      ? "0000-00-00T00:00:00Z"
      : financialTimestamp(options.from, "from");
    const to = options.to === undefined
      ? "9999-12-31T23:59:59.999Z"
      : financialTimestamp(options.to, "to");
    if (to < from) {
      throw invalidDynamoDbInput("El rango de pagos no es válido.");
    }
    const page = await this.base.queryPage({
      consistentRead: options.consistentRead ?? false,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit ?? 25,
      partitionValue: `USER#${id}`,
      sortKey: {
        from: `PAYMENT#${from}#`,
        operation: "BETWEEN",
        to: `PAYMENT#${to}#\uffff`,
      },
    });
    return {
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      payments: page.items.map((item) => this.readPayment(item, itemKey(item))),
    };
  }

  async listByDate(
    date: string,
    options: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number } = {},
  ): Promise<PaymentPage> {
    const paymentDate = financialDate(date, "paymentDate");
    return this.listFromViews(
      (shard) => `PAYMENT_DATE#${paymentDate}#${shard}`,
      "DATE",
      options,
      (payment) => payment.paymentDate === paymentDate,
    );
  }

  async listByStatus(
    status: PaymentStatus,
    options: {
      readonly cursors?: MembershipFanOutCursors;
      readonly from?: string;
      readonly limitPerShard?: number;
      readonly to?: string;
    } = {},
  ): Promise<PaymentPage> {
    if (!isPaymentStatus(status)) {
      throw invalidDynamoDbInput("El estado de pago no es válido.");
    }
    const from = options.from === undefined
      ? "0000-00-00T00:00:00Z"
      : financialTimestamp(options.from, "from");
    const to = options.to === undefined
      ? "9999-12-31T23:59:59.999Z"
      : financialTimestamp(options.to, "to");
    if (to < from) {
      throw invalidDynamoDbInput("El rango de estado de pagos no es válido.");
    }
    return this.listFromViews(
      (shard) => `PAYMENT_STATUS#${status}#${shard}`,
      "STATUS",
      options,
      (payment) => payment.status === status,
      { from: `AT#${from}#`, to: `AT#${to}#\uffff` },
    );
  }

  private async transactPayment(
    input: Parameters<IdempotencyRepository["transactOrReplay"]>[0],
    actions: readonly TransactionAction[],
  ): Promise<IdempotencyResult> {
    try {
      return await this.idempotency.transactOrReplay(input, actions);
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code === "TRANSACTION_CANCELLED" ||
        mapped.code === "CONDITIONAL_CHECK_FAILED"
      ) {
        throw paymentError(
          "PAYMENT_CONFLICT",
          "La operación financiera no cumplió sus condiciones.",
        );
      }
      throw mapped;
    }
  }

  private dateView(payment: Payment, canonicalKey: PrimaryKey): DynamoDbItem {
    const index = operationalIndexKeys.paymentDate(
      payment.paymentDate,
      shardForId(payment.id),
      payment.paidAt,
      payment.id,
    );
    return this.view(payment, canonicalKey, "DATE", index);
  }

  private statusView(payment: Payment, canonicalKey: PrimaryKey): DynamoDbItem {
    return this.statusViewFromReference({
      canonicalKey,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      paymentId: payment.id,
      status: payment.status,
      updatedAt: payment.updatedAt,
      userId: payment.userId,
    });
  }

  private statusViewFromReference(input: {
    readonly canonicalKey: PrimaryKey;
    readonly createdAt: string;
    readonly paidAt: string;
    readonly paymentId: string;
    readonly status: PaymentStatus;
    readonly updatedAt: string;
    readonly userId: string;
  }): DynamoDbItem {
    const index = operationalIndexKeys.paymentStatus(
      input.status,
      shardForId(input.paymentId),
      input.paidAt,
      input.paymentId,
    );
    return {
      ...primaryKeys.view(
        "Payment",
        input.paymentId,
        `STATUS_${input.status}`,
        input.userId,
      ),
      GSI1PK: index.PK,
      GSI1SK: index.SK,
      canonicalPK: input.canonicalKey.PK,
      canonicalSK: input.canonicalKey.SK,
      createdAt: input.createdAt,
      entityType: "View",
      purpose: "STATUS",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      targetType: "Payment",
      updatedAt: input.updatedAt,
    };
  }

  private view(
    payment: Payment,
    canonicalKey: PrimaryKey,
    purpose: "DATE" | "STATUS",
    index: { readonly PK: string; readonly SK: string },
  ): DynamoDbItem {
    return {
      ...primaryKeys.view("Payment", payment.id, purpose, payment.userId),
      GSI1PK: index.PK,
      GSI1SK: index.SK,
      canonicalPK: canonicalKey.PK,
      canonicalSK: canonicalKey.SK,
      createdAt: payment.createdAt,
      entityType: "View",
      purpose,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      targetType: "Payment",
      updatedAt: payment.updatedAt,
    };
  }

  private async listFromViews(
    partition: (shard: Shard) => string,
    purpose: "DATE" | "STATUS",
    options: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number },
    matches: (payment: Payment) => boolean,
    range?: { readonly from: string; readonly to: string },
  ): Promise<PaymentPage> {
    const limit = options.limitPerShard ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw invalidDynamoDbInput("El límite por shard debe estar entre 1 y 25.");
    }
    if (options.cursors !== undefined && (
      Object.keys(options.cursors).length !== SHARDS.length || SHARDS.some((shard) => !(shard in options.cursors!))
    )) throw invalidDynamoDbInput("El cursor de pagos está incompleto.");
    const pages = await Promise.all(
      SHARDS.map(async (shard) => {
        const cursor = options.cursors?.[shard];
        if (cursor === null) return { page: { items: [] as readonly DynamoDbItem[] }, shard };
        return {
        page: await this.base.queryPage({
          ...(cursor === undefined ? {} : { cursor }),
          indexName: "GSI1-Operational",
          limit,
          partitionValue: partition(shard),
          ...(range === undefined
            ? {}
            : { sortKey: { ...range, operation: "BETWEEN" as const } }),
        }), shard };
      }),
    );
    const viewKeys = pages.flatMap(({ page }) => page.items.map(itemKey));
    const canonicalKeys = viewKeys.length === 0
      ? []
      : (await this.base.batchGet(viewKeys, true)).map((item) =>
          this.readViewReference(item, itemKey(item), purpose)
        );
    const payments = canonicalKeys.length === 0
      ? []
      : (await this.base.batchGet(canonicalKeys, true))
          .map((item) => this.readPayment(item, itemKey(item)))
          .filter(matches)
          .sort((left, right) =>
            left.paidAt.localeCompare(right.paidAt) || left.id.localeCompare(right.id)
          );
    const hasNextPage = pages.some(({ page }) => page.nextCursor !== undefined);
    const cursors = Object.fromEntries(pages.map(({ page, shard }) => [shard, page.nextCursor ?? null]));
    return {
      ...(hasNextPage ? { cursors } : {}),
      payments,
    };
  }

  private readViewReference(
    item: DynamoDbItem,
    expectedKey: PrimaryKey,
    purpose: "DATE" | "STATUS",
  ): PrimaryKey {
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "View" ||
      item.targetType !== "Payment" ||
      item.purpose !== purpose ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.canonicalPK !== "string" ||
      typeof item.canonicalSK !== "string"
    ) {
      throw paymentError(
        "PAYMENT_RECORD_INVALID",
        "La vista persistida de pago no es válida.",
      );
    }
    return { PK: item.canonicalPK, SK: item.canonicalSK };
  }

  private readPayment(item: DynamoDbItem, expectedKey: PrimaryKey): Payment {
    const amount = readFiniteNumber(item.amount);
    const version = readFiniteNumber(item.version);
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "Payment" ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.paymentId !== "string" ||
      typeof item.userId !== "string" ||
      typeof item.membershipId !== "string" ||
      typeof item.currency !== "string" ||
      typeof item.paidAt !== "string" ||
      typeof item.paymentDate !== "string" ||
      typeof item.periodStart !== "string" ||
      typeof item.periodEnd !== "string" ||
      typeof item.recordedBy !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      (item.notes !== undefined && typeof item.notes !== "string") ||
      (item.receiptKey !== undefined && typeof item.receiptKey !== "string") ||
      (item.correctionType !== undefined && item.correctionType !== "ADJUSTMENT" && item.correctionType !== "COMPENSATION") ||
      (item.originalPaymentId !== undefined && typeof item.originalPaymentId !== "string") ||
      !isPaymentStatus(item.status) ||
      !isPaymentMethod(item.method) ||
      amount === undefined ||
      version === undefined
    ) {
      throw paymentError("PAYMENT_RECORD_INVALID", "El pago persistido no es válido.");
    }
    try {
      const payment = this.validatePayment({
        amount,
        createdAt: item.createdAt,
        currency: item.currency,
        membershipId: item.membershipId,
        membershipStartDate: item.periodStart,
        method: item.method,
        ...(item.notes === undefined ? {} : { notes: item.notes }),
        paidAt: item.paidAt,
        paymentDate: item.paymentDate,
        paymentId: item.paymentId,
        periodEnd: item.periodEnd,
        periodStart: item.periodStart,
        ...(item.receiptKey === undefined ? {} : { receiptKey: item.receiptKey }),
        recordedBy: item.recordedBy,
        requestKey: "decode-only",
        status: item.status === "VOIDED" ? "CONFIRMED" : item.status,
        userId: item.userId,
      }, version, item.updatedAt, item.status);
      return {
        ...payment,
        ...(item.correctionType === undefined ? {} : { correctionType: item.correctionType }),
        ...(item.originalPaymentId === undefined ? {} : { originalPaymentId: financialId(item.originalPaymentId, "originalPaymentId") }),
      };
    } catch {
      throw paymentError("PAYMENT_RECORD_INVALID", "El pago persistido no es válido.");
    }
  }

  private readCorrection(
    item: DynamoDbItem,
    expectedKey: PrimaryKey,
  ): PaymentCorrection {
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "PaymentCorrection" ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      (item.type !== "VOID" && item.type !== "ADJUSTMENT" && item.type !== "COMPENSATION") ||
      typeof item.actorId !== "string" ||
      typeof item.correctedAt !== "string" ||
      typeof item.correctionId !== "string" ||
      typeof item.originalPaymentId !== "string" ||
      typeof item.reason !== "string" ||
      typeof item.userId !== "string"
    ) {
      throw paymentError(
        "PAYMENT_RECORD_INVALID",
        "La corrección persistida no es válida.",
      );
    }
    financialTimestamp(item.correctedAt, "correctedAt");
    return {
      actorId: financialId(item.actorId, "actorId"),
      correctedAt: item.correctedAt,
      id: financialId(item.correctionId, "correctionId"),
      originalPaymentId: financialId(item.originalPaymentId, "originalPaymentId"),
      reason: financialText(item.reason, "reason", 500),
      ...(item.relatedPaymentId === undefined ? {} : { relatedPaymentId: financialId(item.relatedPaymentId, "relatedPaymentId") }),
      type: item.type,
      userId: financialId(item.userId, "userId"),
    };
  }

  private toItem(payment: Payment, key: PrimaryKey): PaymentItem {
    return {
      ...key,
      amount: payment.amount,
      ...(payment.correctionType === undefined ? {} : { correctionType: payment.correctionType }),
      createdAt: payment.createdAt,
      currency: payment.currency,
      entityType: "Payment",
      membershipId: payment.membershipId,
      method: payment.method,
      ...(payment.notes === undefined ? {} : { notes: payment.notes }),
      paidAt: payment.paidAt,
      ...(payment.originalPaymentId === undefined ? {} : { originalPaymentId: payment.originalPaymentId }),
      paymentDate: payment.paymentDate,
      paymentId: payment.id,
      periodEnd: payment.periodEnd,
      periodStart: payment.periodStart,
      ...(payment.receiptKey === undefined ? {} : { receiptKey: payment.receiptKey }),
      recordedBy: payment.recordedBy,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      status: payment.status,
      updatedAt: payment.updatedAt,
      userId: payment.userId,
      version: payment.version,
    };
  }

  private recordPayload(
    payment: Payment,
    membershipStartDate: string,
    correction?: RecordPaymentInput["correction"],
  ): JsonValue {
    return {
      amount: payment.amount,
      currency: payment.currency,
      ...(payment.correctionType === undefined ? {} : { correctionType: payment.correctionType }),
      membershipId: payment.membershipId,
      membershipStartDate,
      method: payment.method,
      ...(payment.notes === undefined ? {} : { notes: payment.notes }),
      ...(correction === undefined ? { paidAt: payment.paidAt, paymentDate: payment.paymentDate } : {
        expectedOriginalVersion: correction.expectedOriginalVersion,
        originalPaidAt: correction.originalPaidAt,
        reason: correction.reason,
      }),
      paymentId: payment.id,
      periodEnd: payment.periodEnd,
      periodStart: payment.periodStart,
      ...(payment.originalPaymentId === undefined ? {} : { originalPaymentId: payment.originalPaymentId }),
      ...(payment.receiptKey === undefined ? {} : { receiptKey: payment.receiptKey }),
      recordedBy: payment.recordedBy,
      status: payment.status,
      userId: payment.userId,
    };
  }

  private validatePayment(
    input: Omit<RecordPaymentInput, "auditId" | "correlationId" | "status"> & { readonly status: Exclude<PaymentStatus, "VOIDED"> },
    version = 1,
    updatedAtInput = input.createdAt,
    persistedStatus: PaymentStatus = input.status,
  ): Payment {
    if (
      !isPaymentMethod(input.method) ||
      (input.status !== "PENDING" && input.status !== "CONFIRMED") ||
      !isPaymentStatus(persistedStatus)
    ) {
      throw invalidDynamoDbInput("El método o estado de pago no es válido.");
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      throw invalidDynamoDbInput("La versión de pago no es válida.");
    }
    const periodStart = financialDate(input.periodStart, "periodStart");
    const periodEnd = financialDate(input.periodEnd, "periodEnd");
    if (periodEnd < periodStart) {
      throw invalidDynamoDbInput("periodEnd no puede ser anterior a periodStart.");
    }
    const createdAt = financialTimestamp(input.createdAt, "createdAt");
    const updatedAt = financialTimestamp(updatedAtInput, "updatedAt");
    if (updatedAt < createdAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a createdAt.");
    }
    return {
      amount: financialAmount(input.amount, "amount"),
      createdAt,
      currency: financialCurrency(input.currency),
      id: financialId(input.paymentId, "paymentId"),
      membershipId: financialId(input.membershipId, "membershipId"),
      method: input.method,
      ...(() => {
        const notes = optionalFinancialText(input.notes, "notes", 500);
        return notes === undefined ? {} : { notes };
      })(),
      paidAt: financialTimestamp(input.paidAt, "paidAt"),
      paymentDate: financialDate(input.paymentDate, "paymentDate"),
      periodEnd,
      periodStart,
      ...(() => {
        const receiptKey = optionalFinancialText(input.receiptKey, "receiptKey", 512);
        return receiptKey === undefined ? {} : { receiptKey };
      })(),
      recordedBy: financialId(input.recordedBy, "recordedBy"),
      status: persistedStatus,
      updatedAt,
      userId: financialId(input.userId, "userId"),
      version,
    };
  }

  private paymentResult(value: JsonValue): { readonly paidAt: string; readonly paymentId: string; readonly userId: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw paymentError("PAYMENT_RECORD_INVALID", "El resultado idempotente no es válido.");
    const record = value as Readonly<Record<string, JsonValue>>;
    if (typeof record.paidAt !== "string" || typeof record.paymentId !== "string" || typeof record.userId !== "string") throw paymentError("PAYMENT_RECORD_INVALID", "El resultado idempotente no es válido.");
    return { paidAt: financialTimestamp(record.paidAt, "paidAt"), paymentId: financialId(record.paymentId, "paymentId"), userId: financialId(record.userId, "userId") };
  }

  private correctionResult(value: JsonValue): { readonly correctedAt: string; readonly correctionId: string; readonly userId: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw paymentError("PAYMENT_RECORD_INVALID", "El resultado idempotente no es válido.");
    const record = value as Readonly<Record<string, JsonValue>>;
    if (typeof record.correctedAt !== "string" || typeof record.correctionId !== "string" || typeof record.userId !== "string") throw paymentError("PAYMENT_RECORD_INVALID", "El resultado idempotente no es válido.");
    return { correctedAt: financialTimestamp(record.correctedAt, "correctedAt"), correctionId: financialId(record.correctionId, "correctionId"), userId: financialId(record.userId, "userId") };
  }
}
