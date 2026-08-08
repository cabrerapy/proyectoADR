import { AUDIT_RESULTS, type AuditLog, type AuditResult } from "@gym-adr/domain";

import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem, DynamoDbKey } from "./dynamodb-adapter";
import { invalidDynamoDbInput } from "./dynamodb-errors";
import { readFiniteNumber, tableName } from "./financial-validation";
import { primaryKeys, relationshipIndexKeys } from "./model-keys";
import { CURRENT_SCHEMA_VERSION, ENTITY_TYPES, type EntityType, type PrimaryKey } from "./model-types";
import { operationId, operationText, operationTimestamp } from "./operations-validation";

type AuditValue = string | number | boolean | null;
const SENSITIVE_FIELD = /(authorization|cookie|credential|password|secret|token)/iu;

export interface AppendAuditLogInput {
  readonly action: string;
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly details?: Readonly<Record<string, AuditValue>>;
  readonly result: AuditResult;
  readonly targetId: string;
  readonly targetType: EntityType;
  readonly timestamp: string;
}

export interface AuditPage {
  readonly entries: readonly AuditLog[];
  readonly cursor?: DynamoDbKey;
}

const keyOf = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") throw invalidDynamoDbInput("La clave de auditoría no es válida.");
  return { PK: item.PK, SK: item.SK };
};
const isResult = (value: unknown): value is AuditResult => typeof value === "string" && AUDIT_RESULTS.some((result) => result === value);

export class AuditLogRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;
  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async append(input: AppendAuditLogInput): Promise<AuditLog> {
    if (!ENTITY_TYPES.some((type) => type === input.targetType) || !isResult(input.result)) throw invalidDynamoDbInput("El tipo de entidad o resultado de auditoría no es válido.");
    const details = this.sanitize(input.details ?? {});
    const entry: AuditLog = {
      action: operationText(input.action, "action", 100),
      actorId: operationId(input.actorId, "actorId"),
      correlationId: operationId(input.correlationId, "correlationId"),
      details,
      id: operationId(input.auditId, "auditId"),
      result: input.result,
      targetId: operationId(input.targetId, "targetId"),
      targetType: input.targetType,
      timestamp: operationTimestamp(input.timestamp, "timestamp"),
    };
    const index = relationshipIndexKeys.auditActor(entry.actorId, entry.timestamp, entry.id);
    await this.document.put({
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      Item: { ...primaryKeys.auditLog(input.targetType, entry.targetId, entry.timestamp, entry.id), GSI2PK: index.PK, GSI2SK: index.SK, ...entry, auditId: entry.id, entityType: "AuditLog", schemaVersion: CURRENT_SCHEMA_VERSION },
      TableName: this.table,
    });
    return entry;
  }

  async listByEntity(targetType: EntityType, targetId: string, from: string, to: string, options: { readonly cursor?: DynamoDbKey; readonly limit?: number } = {}): Promise<AuditPage> {
    const id = operationId(targetId, "targetId");
    const start = operationTimestamp(from, "from");
    const end = operationTimestamp(to, "to");
    const page = await this.base.queryPage({ ...(options.cursor === undefined ? {} : { cursor: options.cursor }), consistentRead: true, limit: options.limit ?? 25, partitionValue: `AUDIT#ENTITY#${targetType}#${id}`, sortKey: { from: `AT#${start}#`, operation: "BETWEEN", to: `AT#${end}#\uffff` } });
    return { entries: page.items.map((item) => this.read(item)), ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }) };
  }

  async listByActor(actorId: string, from: string, to: string, options: { readonly cursor?: DynamoDbKey; readonly limit?: number } = {}): Promise<AuditPage> {
    const id = operationId(actorId, "actorId");
    const start = operationTimestamp(from, "from");
    const end = operationTimestamp(to, "to");
    const page = await this.base.queryPage({ ...(options.cursor === undefined ? {} : { cursor: options.cursor }), indexName: "GSI2-Relationships", limit: options.limit ?? 25, partitionValue: `AUDIT_ACTOR#${id}`, sortKey: { from: `AT#${start}#`, operation: "BETWEEN", to: `AT#${end}#\uffff` } });
    const entries = page.items.length === 0 ? [] : (await this.base.batchGet(page.items.map(keyOf), true)).map((item) => this.read(item)).filter((entry) => entry.actorId === id).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    return { entries, ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }) };
  }

  private sanitize(details: Readonly<Record<string, AuditValue>>): Readonly<Record<string, AuditValue>> {
    const entries = Object.entries(details);
    if (entries.length > 25) throw invalidDynamoDbInput("La auditoría admite hasta 25 detalles.");
    const safe: Record<string, AuditValue> = {};
    for (const [key, value] of entries) {
      if (SENSITIVE_FIELD.test(key)) throw invalidDynamoDbInput("Los detalles de auditoría contienen un campo sensible.");
      const normalizedKey = operationText(key, "auditDetailKey", 60);
      if (typeof value === "string") safe[normalizedKey] = operationText(value, `details.${normalizedKey}`, 500);
      else if (typeof value === "number" && !Number.isFinite(value)) throw invalidDynamoDbInput("Los detalles de auditoría contienen un número inválido.");
      else safe[normalizedKey] = value;
    }
    return safe;
  }

  private read(item: DynamoDbItem): AuditLog {
    if (item.entityType !== "AuditLog" || typeof item.action !== "string" || typeof item.actorId !== "string" || typeof item.auditId !== "string" || typeof item.correlationId !== "string" || typeof item.details !== "object" || item.details === null || Array.isArray(item.details) || typeof item.targetId !== "string" || typeof item.targetType !== "string" || typeof item.timestamp !== "string" || !isResult(item.result)) throw invalidDynamoDbInput("El registro de auditoría no es válido.");
    return { action: item.action, actorId: item.actorId, correlationId: item.correlationId, details: this.readDetails(item.details), id: item.auditId, result: item.result, targetId: item.targetId, targetType: item.targetType, timestamp: item.timestamp };
  }

  private readDetails(value: object): Readonly<Record<string, AuditValue>> {
    const details: Record<string, AuditValue> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === "string" || typeof raw === "boolean" || raw === null) details[key] = raw;
      else {
        const number = readFiniteNumber(raw);
        if (number === undefined) throw invalidDynamoDbInput("Los detalles persistidos de auditoría no son válidos.");
        details[key] = number;
      }
    }
    return details;
  }
}
