import {
  SCHEDULING_CATALOG_STATUSES,
  type ClassType,
  type SchedulingCatalogStatus,
  type Trainer,
} from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { AuditLogRepository } from "./audit-log-repository";
import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem, DynamoDbKey } from "./dynamodb-adapter";
import { DynamoDbRepositoryError, invalidDynamoDbInput, mapDynamoDbError } from "./dynamodb-errors";
import { financialId, financialText, financialTimestamp, optionalFinancialText, readFiniteNumber, tableName } from "./financial-validation";
import { primaryKeys } from "./model-keys";
import { SHARDS, shardForId } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";

type TransactionAction = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type CatalogKind = "ClassType" | "Trainer";
type CatalogEntity = ClassType | Trainer;
export type SchedulingCatalogCursors = Readonly<Record<string, DynamoDbKey | null | undefined>>;

export interface SchedulingCatalogPage<T extends CatalogEntity> {
  readonly cursors?: SchedulingCatalogCursors;
  readonly items: readonly T[];
}

export interface CreateSchedulingCatalogInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly description?: string;
  readonly id: string;
  readonly name: string;
}

export interface UpdateSchedulingCatalogInput extends Omit<CreateSchedulingCatalogInput, "createdAt"> {
  readonly expectedVersion: number;
  readonly status: SchedulingCatalogStatus;
  readonly updatedAt: string;
}

const catalogError = (code: "CATALOG_CONFLICT" | "CATALOG_RECORD_INVALID" | "RESOURCE_NOT_FOUND", message: string) =>
  new DynamoDbRepositoryError(code, message);
const isStatus = (value: unknown): value is SchedulingCatalogStatus =>
  typeof value === "string" && SCHEDULING_CATALOG_STATUSES.some((status) => status === value);
const catalogToken = (kind: CatalogKind): "CLASS_TYPE" | "TRAINER" => kind === "ClassType" ? "CLASS_TYPE" : "TRAINER";
const normalizedName = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "item";
const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") throw catalogError("CATALOG_RECORD_INVALID", "La clave del catálogo no es válida.");
  return { PK: item.PK, SK: item.SK };
};

export class SchedulingCatalogRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  createTrainer(input: CreateSchedulingCatalogInput): Promise<Trainer> {
    return this.create("Trainer", input) as Promise<Trainer>;
  }

  createClassType(input: CreateSchedulingCatalogInput): Promise<ClassType> {
    return this.create("ClassType", input) as Promise<ClassType>;
  }

  getTrainer(id: string): Promise<Trainer | undefined> {
    return this.get("Trainer", id) as Promise<Trainer | undefined>;
  }

  getClassType(id: string): Promise<ClassType | undefined> {
    return this.get("ClassType", id) as Promise<ClassType | undefined>;
  }

  listTrainers(status: SchedulingCatalogStatus | "ALL" = "ALL", cursors?: SchedulingCatalogCursors): Promise<SchedulingCatalogPage<Trainer>> {
    return this.list("Trainer", status, cursors) as Promise<SchedulingCatalogPage<Trainer>>;
  }

  listClassTypes(status: SchedulingCatalogStatus | "ALL" = "ALL", cursors?: SchedulingCatalogCursors): Promise<SchedulingCatalogPage<ClassType>> {
    return this.list("ClassType", status, cursors) as Promise<SchedulingCatalogPage<ClassType>>;
  }

  updateTrainer(input: UpdateSchedulingCatalogInput): Promise<Trainer> {
    return this.update("Trainer", input) as Promise<Trainer>;
  }

  updateClassType(input: UpdateSchedulingCatalogInput): Promise<ClassType> {
    return this.update("ClassType", input) as Promise<ClassType>;
  }

  destroy(): void { this.base.destroy(); }

  private async create(kind: CatalogKind, input: CreateSchedulingCatalogInput): Promise<CatalogEntity> {
    const entity = this.validate(kind, input);
    await this.write(kind, entity, input.auditId, input.correlationId, `${catalogToken(kind)}_CREATED`);
    return entity;
  }

  private async update(kind: CatalogKind, input: UpdateSchedulingCatalogInput): Promise<CatalogEntity> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw invalidDynamoDbInput("La versión no es válida.");
    const current = await this.get(kind, input.id);
    if (current === undefined) throw catalogError("RESOURCE_NOT_FOUND", "El elemento solicitado no existe.");
    if (current.version !== input.expectedVersion) throw catalogError("CATALOG_CONFLICT", "El elemento fue modificado.");
    const next = this.validate(kind, { ...input, createdAt: current.createdAt }, input.expectedVersion + 1, input.updatedAt, input.status, current.createdBy);
    await this.write(kind, next, input.auditId, input.correlationId, next.status === current.status ? `${catalogToken(kind)}_UPDATED` : `${catalogToken(kind)}_STATUS_${next.status}`, input.expectedVersion);
    return next;
  }

  private async get(kind: CatalogKind, id: string): Promise<CatalogEntity | undefined> {
    const key = this.key(kind, financialId(id, "id"));
    const item = await this.base.get(key, true);
    return item === undefined ? undefined : this.read(kind, item, key);
  }

  private async list(kind: CatalogKind, status: SchedulingCatalogStatus | "ALL", cursors?: SchedulingCatalogCursors): Promise<SchedulingCatalogPage<CatalogEntity>> {
    if (status !== "ALL" && !isStatus(status)) throw invalidDynamoDbInput("El estado no es válido.");
    const statuses = status === "ALL" ? SCHEDULING_CATALOG_STATUSES : [status] as const;
    const cursorKeys = statuses.flatMap((entry) => SHARDS.map((shard) => `${entry}:${shard}`));
    if (cursors !== undefined && (Object.keys(cursors).length !== cursorKeys.length || cursorKeys.some((key) => !(key in cursors)))) throw invalidDynamoDbInput("El cursor está incompleto.");
    const pages = await Promise.all(cursorKeys.map(async (cursorKey) => {
      const [entry, shard] = cursorKey.split(":") as [SchedulingCatalogStatus, string];
      const cursor = cursors?.[cursorKey];
      if (cursor === null) return { cursorKey, page: { items: [] as readonly DynamoDbItem[] } };
      const page = await this.base.queryPage({ ...(cursor === undefined ? {} : { cursor }), indexName: "GSI1-Operational", limit: 25, partitionValue: `CATALOG#${catalogToken(kind)}#${entry}#${shard}` });
      return { cursorKey, page };
    }));
    const keys = pages.flatMap(({ page }) => page.items.map(itemKey));
    const items = keys.length === 0 ? [] : (await this.base.batchGet(keys, true)).map((item) => this.read(kind, item, itemKey(item))).filter((item) => status === "ALL" || item.status === status).sort((a, b) => a.name.localeCompare(b.name, "es"));
    const hasNext = pages.some(({ page }) => page.nextCursor !== undefined);
    return { ...(hasNext ? { cursors: Object.fromEntries(pages.map(({ cursorKey, page }) => [cursorKey, page.nextCursor ?? null])) } : {}), items };
  }

  private async write(kind: CatalogKind, entity: CatalogEntity, auditId: string, correlationId: string, action: string, expectedVersion?: number): Promise<void> {
    const key = this.key(kind, entity.id);
    const description = kind === "Trainer" ? (entity as Trainer).bio : (entity as ClassType).description;
    const audit = new AuditLogRepository(this.document, this.table).createAppendAction({ action, actorId: entity.updatedBy, auditId, correlationId, details: { name: entity.name, status: entity.status, version: entity.version }, result: "SUCCEEDED", targetId: entity.id, targetType: kind, timestamp: entity.updatedAt }).action;
    const put: TransactionAction = { Put: { ConditionExpression: expectedVersion === undefined ? "attribute_not_exists(#pk) AND attribute_not_exists(#sk)" : "attribute_exists(#pk) AND #version = :expectedVersion", ExpressionAttributeNames: expectedVersion === undefined ? { "#pk": "PK", "#sk": "SK" } : { "#pk": "PK", "#version": "version" }, ...(expectedVersion === undefined ? {} : { ExpressionAttributeValues: { ":expectedVersion": expectedVersion } }), Item: { ...key, GSI1PK: `CATALOG#${catalogToken(kind)}#${entity.status}#${shardForId(entity.id)}`, GSI1SK: `NAME#${normalizedName(entity.name)}#${entity.id}`, createdAt: entity.createdAt, createdBy: entity.createdBy, ...(description === undefined ? {} : { [kind === "Trainer" ? "bio" : "description"]: description }), entityType: kind, name: entity.name, schemaVersion: CURRENT_SCHEMA_VERSION, status: entity.status, updatedAt: entity.updatedAt, updatedBy: entity.updatedBy, version: entity.version, [kind === "Trainer" ? "trainerId" : "classTypeId"]: entity.id }, TableName: this.table } };
    try { await this.document.transactWrite({ TransactItems: [put, audit] }); } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") throw catalogError("CATALOG_CONFLICT", "El elemento fue modificado por otra operación.");
      throw mapped;
    }
  }

  private key(kind: CatalogKind, id: string): PrimaryKey { return kind === "Trainer" ? primaryKeys.trainer(id) : primaryKeys.classType(id); }

  private read(kind: CatalogKind, item: DynamoDbItem, key: PrimaryKey): CatalogEntity {
    const version = readFiniteNumber(item.version);
    const id = item[kind === "Trainer" ? "trainerId" : "classTypeId"];
    if (item.PK !== key.PK || item.SK !== key.SK || item.entityType !== kind || typeof id !== "string" || typeof item.name !== "string" || !isStatus(item.status) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.createdBy !== "string" || typeof item.updatedBy !== "string" || version === undefined) throw catalogError("CATALOG_RECORD_INVALID", "El elemento persistido no es válido.");
    const description = kind === "Trainer" ? item.bio : item.description;
    if (description !== undefined && typeof description !== "string") throw catalogError("CATALOG_RECORD_INVALID", "La descripción persistida no es válida.");
    return this.validate(kind, { actorId: item.updatedBy, auditId: "read-only", correlationId: "read-only", createdAt: item.createdAt, ...(description === undefined ? {} : { description }), id, name: item.name }, version, item.updatedAt, item.status, item.createdBy);
  }

  private validate(kind: CatalogKind, input: CreateSchedulingCatalogInput, version = 1, updatedAtInput = input.createdAt, status: SchedulingCatalogStatus = "ACTIVE", createdByInput = input.actorId): CatalogEntity {
    if (!isStatus(status) || !Number.isSafeInteger(version) || version < 1) throw invalidDynamoDbInput("El estado o versión no es válido.");
    const description = optionalFinancialText(input.description, "description", 500);
    const common = { createdAt: financialTimestamp(input.createdAt, "createdAt"), createdBy: financialId(createdByInput, "createdBy"), id: financialId(input.id, "id"), name: financialText(input.name, "name", 120), status, updatedAt: financialTimestamp(updatedAtInput, "updatedAt"), updatedBy: financialId(input.actorId, "actorId"), version };
    if (common.name.length < 2 || common.updatedAt < common.createdAt) throw invalidDynamoDbInput("El nombre o fecha no es válido.");
    return kind === "Trainer" ? { ...common, ...(description === undefined ? {} : { bio: description }) } : { ...common, ...(description === undefined ? {} : { description }) };
  }
}
