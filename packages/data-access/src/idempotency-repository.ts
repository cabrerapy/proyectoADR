import { createHash } from "node:crypto";
import {
  NumberValue,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import type { DynamoDbDocumentPort, DynamoDbItem } from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
  mapDynamoDbError,
} from "./dynamodb-errors";
import { primaryKeys } from "./model-keys";
import { CURRENT_SCHEMA_VERSION } from "./model-types";
import { assertTimestamp } from "./model-validation";

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type IdempotencyRetention =
  | { readonly kind: "DURABLE" }
  | {
      readonly expiresAtEpochSeconds: number;
      readonly kind: "EPHEMERAL";
    };

export interface RecordIdempotencyInput {
  readonly createdAt: string;
  readonly operation: string;
  readonly payload: JsonValue;
  readonly requestKey: string;
  readonly result: JsonValue;
  readonly retention: IdempotencyRetention;
  readonly subjectId: string;
}

export interface IdempotencyResult {
  readonly disposition: "CREATED" | "REPLAYED";
  readonly result: JsonValue;
}

export type TransactionAction = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

interface IdempotencyItem extends DynamoDbItem {
  readonly createdAt: string;
  readonly entityType: "Idempotency";
  readonly expiresAt?: number;
  readonly payloadHash: string;
  readonly result: JsonValue;
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly status: "COMPLETED";
  readonly updatedAt: string;
}

const hashPattern = /^[a-f0-9]{64}$/u;
const isJsonArray = (value: JsonValue): value is readonly JsonValue[] =>
  Array.isArray(value);

const canonicalJson = (value: JsonValue, ancestors = new Set<object>()): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidDynamoDbInput("La carga idempotente contiene un número no válido.");
    }
    return JSON.stringify(value);
  }

  if (ancestors.has(value)) {
    throw invalidDynamoDbInput("La carga idempotente contiene una referencia circular.");
  }
  ancestors.add(value);
  try {
    if (isJsonArray(value)) {
      return `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidDynamoDbInput("La carga idempotente debe contener sólo valores JSON.");
    }
    return `{${Object.keys(value)
      .sort()
      .map((entry) => `${JSON.stringify(entry)}:${canonicalJson(value[entry] as JsonValue, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

export const hashIdempotencyPayload = (payload: JsonValue): string =>
  createHash("sha256").update(canonicalJson(payload)).digest("hex");

const validatedTimestamp = (value: string): string => {
  try {
    const timestamp = assertTimestamp(value, "createdAt");
    if (!Number.isFinite(Date.parse(timestamp))) {
      throw new Error("invalid timestamp");
    }
    return timestamp;
  } catch {
    throw invalidDynamoDbInput("createdAt no es un timestamp UTC válido.");
  }
};

const idempotencyKey = (
  operation: string,
  subjectId: string,
  requestKey: string,
) => {
  try {
    return primaryKeys.idempotency(operation, subjectId, requestKey);
  } catch {
    throw invalidDynamoDbInput(
      "La operación, sujeto o clave idempotente no tienen un formato válido.",
    );
  }
};

const assertTableName = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{3,255}$/u.test(value)) {
    throw invalidDynamoDbInput("El nombre de tabla DynamoDB no es válido.");
  }
  return value;
};

const expiresAtFor = (
  retention: IdempotencyRetention,
  createdAt: string,
): number | undefined => {
  if (retention.kind === "DURABLE") {
    return undefined;
  }
  const createdAtEpochSeconds = Math.floor(Date.parse(createdAt) / 1_000);
  if (
    !Number.isSafeInteger(retention.expiresAtEpochSeconds) ||
    retention.expiresAtEpochSeconds <= createdAtEpochSeconds
  ) {
    throw invalidDynamoDbInput(
      "La expiración efímera debe ser un epoch second posterior a createdAt.",
    );
  }
  return retention.expiresAtEpochSeconds;
};

const isJsonValue = (value: unknown, ancestors = new Set<object>()): value is JsonValue => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((entry) => isJsonValue(entry, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
};

const wrappedNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!(value instanceof NumberValue)) {
    return undefined;
  }
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const decodePersistedJson = (
  value: unknown,
  ancestors = new Set<object>(),
): JsonValue => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  const numeric = wrappedNumber(value);
  if (numeric !== undefined) {
    return numeric;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new DynamoDbRepositoryError(
      "IDEMPOTENCY_RECORD_INVALID",
      "El registro de idempotencia persistido no es válido.",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => decodePersistedJson(entry, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DynamoDbRepositoryError(
        "IDEMPOTENCY_RECORD_INVALID",
        "El registro de idempotencia persistido no es válido.",
      );
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        decodePersistedJson(entry, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
};

const readItem = (
  item: DynamoDbItem | undefined,
  expectedKey: { readonly PK: string; readonly SK: string },
): IdempotencyItem => {
  const schemaVersion = wrappedNumber(item?.schemaVersion);
  const expiresAt = item?.expiresAt === undefined
    ? undefined
    : wrappedNumber(item.expiresAt);
  if (
    item === undefined ||
    item.PK !== expectedKey.PK ||
    item.SK !== expectedKey.SK ||
    item.entityType !== "Idempotency" ||
    schemaVersion !== CURRENT_SCHEMA_VERSION ||
    item.status !== "COMPLETED" ||
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string" ||
    typeof item.payloadHash !== "string" ||
    !hashPattern.test(item.payloadHash) ||
    (item.expiresAt !== undefined &&
      (expiresAt === undefined || !Number.isSafeInteger(expiresAt) || expiresAt < 1))
  ) {
    throw new DynamoDbRepositoryError(
      "IDEMPOTENCY_RECORD_INVALID",
      "El registro de idempotencia persistido no es válido.",
    );
  }
  return {
    ...item,
    expiresAt,
    result: decodePersistedJson(item.result),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  } as IdempotencyItem;
};

export class IdempotencyRepository {
  private readonly tableName: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    tableName: string,
  ) {
    this.tableName = assertTableName(tableName);
  }

  async recordOrReplay(input: RecordIdempotencyInput): Promise<IdempotencyResult> {
    if (!isJsonValue(input.result)) {
      throw invalidDynamoDbInput(
        "El resultado idempotente debe contener sólo valores JSON.",
      );
    }
    const createdAt = validatedTimestamp(input.createdAt);
    const key = idempotencyKey(
      input.operation,
      input.subjectId,
      input.requestKey,
    );
    const payloadHash = hashIdempotencyPayload(input.payload);
    const expiresAt = expiresAtFor(input.retention, createdAt);
    const item: IdempotencyItem = {
      ...key,
      createdAt,
      entityType: "Idempotency",
      payloadHash,
      result: input.result,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      status: "COMPLETED",
      updatedAt: createdAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };

    try {
      await this.document.put({
        ConditionExpression:
          "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        Item: item,
        TableName: this.tableName,
      });
      return { disposition: "CREATED", result: item.result };
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code !== "CONDITIONAL_CHECK_FAILED") {
        throw mapped;
      }
    }

    let existing: DynamoDbItem | undefined;
    try {
      const response = await this.document.get({
        ConsistentRead: true,
        Key: key,
        TableName: this.tableName,
      });
      existing = response.Item;
    } catch (error) {
      throw mapDynamoDbError(error);
    }

    const persisted = readItem(existing, key);
    if (persisted.payloadHash !== payloadHash) {
      throw new DynamoDbRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "La clave idempotente ya fue utilizada con una carga diferente.",
      );
    }
    return { disposition: "REPLAYED", result: persisted.result };
  }

  async transactOrReplay(
    input: RecordIdempotencyInput,
    actions: readonly TransactionAction[],
  ): Promise<IdempotencyResult> {
    if (actions.length < 1 || actions.length > 99) {
      throw invalidDynamoDbInput(
        "La transacción idempotente requiere entre 1 y 99 acciones de negocio.",
      );
    }
    if (!isJsonValue(input.result)) {
      throw invalidDynamoDbInput(
        "El resultado idempotente debe contener sólo valores JSON.",
      );
    }
    const createdAt = validatedTimestamp(input.createdAt);
    const key = idempotencyKey(
      input.operation,
      input.subjectId,
      input.requestKey,
    );
    const payloadHash = hashIdempotencyPayload(input.payload);
    const expiresAt = expiresAtFor(input.retention, createdAt);
    const item: IdempotencyItem = {
      ...key,
      createdAt,
      entityType: "Idempotency",
      payloadHash,
      result: input.result,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      status: "COMPLETED",
      updatedAt: createdAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };

    try {
      await this.document.transactWrite({
        TransactItems: [
          ...actions,
          {
            Put: {
              ConditionExpression:
                "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
              ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
              Item: item,
              TableName: this.tableName,
            },
          },
        ],
      });
      return { disposition: "CREATED", result: item.result };
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code !== "TRANSACTION_CANCELLED" &&
        mapped.code !== "CONDITIONAL_CHECK_FAILED"
      ) {
        throw mapped;
      }

      let existing: DynamoDbItem | undefined;
      try {
        existing = (await this.document.get({
          ConsistentRead: true,
          Key: key,
          TableName: this.tableName,
        })).Item;
      } catch (readError) {
        throw mapDynamoDbError(readError);
      }
      if (existing === undefined) {
        throw mapped;
      }
      const persisted = readItem(existing, key);
      if (persisted.payloadHash !== payloadHash) {
        throw new DynamoDbRepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "La clave idempotente ya fue utilizada con una carga diferente.",
        );
      }
      return { disposition: "REPLAYED", result: persisted.result };
    }
  }
}
