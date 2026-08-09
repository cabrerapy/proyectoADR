import {
  MEMBERSHIP_FREQUENCIES,
  MEMBERSHIP_PLAN_STATUSES,
  type MembershipFrequency,
  type MembershipPlan,
  type MembershipPlanStatus,
} from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { AuditLogRepository } from "./audit-log-repository";
import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem, DynamoDbKey } from "./dynamodb-adapter";
import { DynamoDbRepositoryError, invalidDynamoDbInput, mapDynamoDbError } from "./dynamodb-errors";
import {
  financialAmount,
  financialCurrency,
  financialId,
  financialText,
  financialTimestamp,
  readFiniteNumber,
  tableName,
} from "./financial-validation";
import { operationalIndexKeys, primaryKeys } from "./model-keys";
import { SHARDS, shardForId, type Shard } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";

type TransactionAction = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
export type MembershipPlanCursors = Readonly<Record<string, DynamoDbKey | null | undefined>>;

export interface CreateMembershipPlanInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly currency: string;
  readonly description?: string;
  readonly frequency: MembershipFrequency;
  readonly name: string;
  readonly planId: string;
  readonly price: number;
}

export interface UpdateMembershipPlanInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly description?: string;
  readonly expectedVersion: number;
  readonly frequency: MembershipFrequency;
  readonly name: string;
  readonly planId: string;
  readonly price: number;
  readonly status: MembershipPlanStatus;
  readonly updatedAt: string;
}

export interface MembershipPlanPage {
  readonly cursors?: MembershipPlanCursors;
  readonly plans: readonly MembershipPlan[];
}

const planError = (
  code: "PLAN_CONFLICT" | "PLAN_RECORD_INVALID" | "RESOURCE_NOT_FOUND",
  message: string,
): DynamoDbRepositoryError => new DynamoDbRepositoryError(code, message);

const isFrequency = (value: unknown): value is MembershipFrequency =>
  typeof value === "string" && MEMBERSHIP_FREQUENCIES.some((frequency) => frequency === value);
const isStatus = (value: unknown): value is MembershipPlanStatus =>
  typeof value === "string" && MEMBERSHIP_PLAN_STATUSES.some((status) => status === value);
const normalizedPlanName = (value: string): string => value
  .normalize("NFKD")
  .replace(/\p{M}/gu, "")
  .toLocaleLowerCase("es")
  .replace(/[^a-z0-9]+/gu, "-")
  .replace(/^-|-$/gu, "") || "plan";

const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw planError("PLAN_RECORD_INVALID", "La clave persistida del plan no es válida.");
  }
  return { PK: item.PK, SK: item.SK };
};

export class MembershipPlanRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async create(input: CreateMembershipPlanInput): Promise<MembershipPlan> {
    const plan = this.validateCreate(input);
    const audit = this.auditAction(plan, input.auditId, input.correlationId, "PLAN_CREATED", undefined);
    try {
      await this.document.transactWrite({
        TransactItems: [this.putAction(plan, "attribute_not_exists(#pk) AND attribute_not_exists(#sk)"), audit],
      });
    } catch (error) {
      this.mapWriteError(error);
    }
    return plan;
  }

  destroy(): void {
    this.base.destroy();
  }

  async getById(planId: string, consistentRead = true): Promise<MembershipPlan | undefined> {
    const key = primaryKeys.membershipPlan(financialId(planId, "planId"));
    const item = await this.base.get(key, consistentRead);
    return item === undefined ? undefined : this.read(item, key);
  }

  async list(
    status: MembershipPlanStatus | "ALL" = "ALL",
    options: { readonly cursors?: MembershipPlanCursors; readonly limitPerShard?: number } = {},
  ): Promise<MembershipPlanPage> {
    if (status !== "ALL" && !isStatus(status)) {
      throw invalidDynamoDbInput("El estado del plan no es válido.");
    }
    const limit = options.limitPerShard ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw invalidDynamoDbInput("El límite por shard debe estar entre 1 y 25.");
    }
    const statuses = status === "ALL" ? MEMBERSHIP_PLAN_STATUSES : [status] as const;
    const expectedCursorKeys = statuses.flatMap((currentStatus) => SHARDS.map((shard) => `${currentStatus}:${shard}`));
    const receivedCursors = options.cursors;
    if (receivedCursors !== undefined && (
      Object.keys(receivedCursors).length !== expectedCursorKeys.length ||
      expectedCursorKeys.some((key) => !(key in receivedCursors))
    )) throw invalidDynamoDbInput("El cursor de planes está incompleto.");
    const pages = await Promise.all(statuses.flatMap((currentStatus) => SHARDS.map(async (shard) => {
      const cursorKey = `${currentStatus}:${shard}`;
      const cursor = options.cursors?.[cursorKey];
      if (cursor === null) return { cursorKey, page: { items: [] as readonly DynamoDbItem[] } };
      const page = await this.base.queryPage({
        ...(cursor === undefined ? {} : { cursor }),
        indexName: "GSI1-Operational",
        limit,
        partitionValue: `PLAN_STATUS#${currentStatus}#${shard}`,
      });
      return { cursorKey, page };
    })));
    const keys = pages.flatMap(({ page }) => page.items.map(itemKey));
    const plans = keys.length === 0
      ? []
      : (await this.base.batchGet(keys, true))
          .map((item) => this.read(item, itemKey(item)))
          .filter((plan) => status === "ALL" || plan.status === status)
          .sort((left, right) => left.name.localeCompare(right.name, "es") || left.id.localeCompare(right.id));
    const hasNextPage = pages.some(({ page }) => page.nextCursor !== undefined);
    const cursors = Object.fromEntries(pages.map(({ cursorKey, page }) => [cursorKey, page.nextCursor ?? null]));
    return { ...(hasNextPage ? { cursors } : {}), plans };
  }

  async update(input: UpdateMembershipPlanInput): Promise<MembershipPlan> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw invalidDynamoDbInput("La versión del plan no es válida.");
    }
    const current = await this.getById(input.planId, true);
    if (current === undefined) throw planError("RESOURCE_NOT_FOUND", "El plan solicitado no existe.");
    if (current.version !== input.expectedVersion) {
      throw planError("PLAN_CONFLICT", "El plan fue modificado por otra operación.");
    }
    const next = this.validateCreate({
      ...input,
      createdAt: current.createdAt,
      planId: current.id,
    }, input.expectedVersion + 1, input.updatedAt, input.status, current.createdBy);
    if (next.updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("La fecha de actualización no puede ser anterior al plan vigente.");
    }
    const audit = this.auditAction(
      next,
      input.auditId,
      input.correlationId,
      next.status !== current.status ? `PLAN_STATUS_${next.status}` : "PLAN_UPDATED",
      current,
    );
    try {
      await this.document.transactWrite({
        TransactItems: [
          this.putAction(next, "attribute_exists(#pk) AND #version = :expectedVersion", input.expectedVersion),
          audit,
        ],
      });
    } catch (error) {
      this.mapWriteError(error);
    }
    return next;
  }

  private auditAction(
    plan: MembershipPlan,
    auditId: string,
    correlationId: string,
    action: string,
    previous: MembershipPlan | undefined,
  ): TransactionAction {
    return new AuditLogRepository(this.document, this.table).createAppendAction({
      action,
      actorId: plan.updatedBy,
      auditId,
      correlationId,
      details: {
        ...(previous === undefined ? {} : { fromStatus: previous.status }),
        name: plan.name,
        price: plan.price,
        status: plan.status,
        version: plan.version,
      },
      result: "SUCCEEDED",
      targetId: plan.id,
      targetType: "MembershipPlan",
      timestamp: plan.updatedAt,
    }).action;
  }

  private mapWriteError(error: unknown): never {
    const mapped = mapDynamoDbError(error);
    if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") {
      throw planError("PLAN_CONFLICT", "El plan fue modificado por otra operación.");
    }
    throw mapped;
  }

  private putAction(plan: MembershipPlan, condition: string, expectedVersion?: number): TransactionAction {
    const index = operationalIndexKeys.planStatus(
      plan.status,
      shardForId(plan.id),
      normalizedPlanName(plan.name),
      plan.id,
    );
    return {
      Put: {
        ConditionExpression: condition,
        ExpressionAttributeNames: expectedVersion === undefined
          ? { "#pk": "PK", "#sk": "SK" }
          : { "#pk": "PK", "#version": "version" },
        ...(expectedVersion === undefined ? {} : { ExpressionAttributeValues: { ":expectedVersion": expectedVersion } }),
        Item: {
          ...primaryKeys.membershipPlan(plan.id),
          GSI1PK: index.PK,
          GSI1SK: index.SK,
          createdAt: plan.createdAt,
          createdBy: plan.createdBy,
          currency: plan.currency,
          ...(plan.description === undefined ? {} : { description: plan.description }),
          entityType: "MembershipPlan",
          frequency: plan.frequency,
          name: plan.name,
          planId: plan.id,
          price: plan.price,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          status: plan.status,
          updatedAt: plan.updatedAt,
          updatedBy: plan.updatedBy,
          version: plan.version,
        },
        TableName: this.table,
      },
    };
  }

  private read(item: DynamoDbItem, key: PrimaryKey): MembershipPlan {
    const price = readFiniteNumber(item.price);
    const version = readFiniteNumber(item.version);
    if (
      item.PK !== key.PK || item.SK !== key.SK || item.entityType !== "MembershipPlan" ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION || typeof item.planId !== "string" ||
      typeof item.name !== "string" || (item.description !== undefined && typeof item.description !== "string") ||
      typeof item.currency !== "string" || !isFrequency(item.frequency) || !isStatus(item.status) ||
      typeof item.createdBy !== "string" || typeof item.updatedBy !== "string" ||
      typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
      price === undefined || version === undefined
    ) throw planError("PLAN_RECORD_INVALID", "El plan persistido no es válido.");
    try {
      return this.validateCreate({
        actorId: item.updatedBy,
        auditId: "read-only",
        correlationId: "read-only",
        createdAt: item.createdAt,
        currency: item.currency,
        ...(item.description === undefined ? {} : { description: item.description }),
        frequency: item.frequency,
        name: item.name,
        planId: item.planId,
        price,
      }, version, item.updatedAt, item.status, item.createdBy);
    } catch {
      throw planError("PLAN_RECORD_INVALID", "El plan persistido no es válido.");
    }
  }

  private validateCreate(
    input: CreateMembershipPlanInput,
    version = 1,
    updatedAtInput = input.createdAt,
    status: MembershipPlanStatus = "ACTIVE",
    createdByInput = input.actorId,
  ): MembershipPlan {
    if (!isFrequency(input.frequency) || !isStatus(status) || !Number.isSafeInteger(version) || version < 1) {
      throw invalidDynamoDbInput("La frecuencia, estado o versión del plan no es válida.");
    }
    const createdAt = financialTimestamp(input.createdAt, "createdAt");
    const updatedAt = financialTimestamp(updatedAtInput, "updatedAt");
    const currency = financialCurrency(input.currency);
    if (currency !== "PYG") throw invalidDynamoDbInput("El MVP admite planes únicamente en PYG.");
    return {
      createdAt,
      createdBy: financialId(createdByInput, "createdBy"),
      currency,
      ...(input.description === undefined ? {} : { description: financialText(input.description, "description", 500) }),
      frequency: input.frequency,
      id: financialId(input.planId, "planId"),
      name: financialText(input.name, "name", 120),
      price: financialAmount(input.price, "price"),
      status,
      updatedAt,
      updatedBy: financialId(input.actorId, "actorId"),
      version,
    };
  }
}
