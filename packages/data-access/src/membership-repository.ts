import {
  MEMBERSHIP_FREQUENCIES,
  MEMBERSHIP_STATUSES,
  canTransitionMembership,
  type Membership,
  type MembershipFrequency,
  type MembershipStatus,
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
import {
  financialAmount,
  financialCurrency,
  financialDate,
  financialId,
  financialText,
  financialTimestamp,
  readFiniteNumber,
  tableName,
} from "./financial-validation";
import { operationalIndexKeys, primaryKeys } from "./model-keys";
import { SHARDS, shardForId, type Shard } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";

type TransactionAction = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

export type FinancialFanOutCursors = Readonly<
  Record<string, DynamoDbKey | undefined>
>;

export type MembershipFanOutCursors = Readonly<
  Record<string, DynamoDbKey | null | undefined>
>;

export interface CreateMembershipInput {
  readonly auditId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly currency: string;
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly frequency: MembershipFrequency;
  readonly membershipId: string;
  readonly planId: string;
  readonly planName: string;
  readonly startDate: string;
  readonly status: MembershipStatus;
  readonly userId: string;
}

export interface UpdateMembershipInput {
  readonly actorId: string;
  readonly auditId: string;
  readonly correlationId: string;
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly expectedVersion: number;
  readonly membershipId: string;
  readonly reason?: string;
  readonly startDate: string;
  readonly status: MembershipStatus;
  readonly updatedAt: string;
  readonly userId: string;
}

export interface MembershipPage {
  readonly cursors?: MembershipFanOutCursors;
  readonly memberships: readonly Membership[];
}

interface MembershipItem extends DynamoDbItem {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly currency: string;
  readonly endDate: string;
  readonly entityType: "Membership";
  readonly expectedAmount: number;
  readonly frequency: MembershipFrequency;
  readonly membershipId: string;
  readonly planId: string;
  readonly planName: string;
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly startDate: string;
  readonly status: MembershipStatus;
  readonly updatedAt: string;
  readonly userId: string;
  readonly version: number;
}

const membershipError = (
  code: "MEMBERSHIP_CONFLICT" | "MEMBERSHIP_RECORD_INVALID",
  message: string,
): DynamoDbRepositoryError => new DynamoDbRepositoryError(code, message);

const isMembershipStatus = (value: unknown): value is MembershipStatus =>
  typeof value === "string" &&
  MEMBERSHIP_STATUSES.some((status) => status === value);

const isFrequency = (value: unknown): value is MembershipFrequency =>
  typeof value === "string" &&
  MEMBERSHIP_FREQUENCIES.some((frequency) => frequency === value);

const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw membershipError(
      "MEMBERSHIP_RECORD_INVALID",
      "La clave persistida de membresía no es válida.",
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

const calendarEpochDay = (value: string): number =>
  Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000);

export class MembershipRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    table: string,
  ) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async create(input: CreateMembershipInput): Promise<Membership> {
    const membership = this.validateCreate(input);
    const key = primaryKeys.membership(
      membership.userId,
      membership.startDate,
      membership.id,
    );
    const actions: TransactionAction[] = [
      {
        ConditionCheck: {
          ConditionExpression: "attribute_exists(#pk) AND #entityType = :profile AND #status = :active AND contains(#roles, :student)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#pk": "PK", "#roles": "roles", "#status": "status" },
          ExpressionAttributeValues: { ":active": "ACTIVE", ":profile": "UserProfile", ":student": "STUDENT" },
          Key: primaryKeys.userProfile(membership.userId),
          TableName: this.table,
        },
      },
      {
        ConditionCheck: {
          ConditionExpression: "attribute_exists(#pk) AND #entityType = :plan AND #status = :active AND #name = :name AND #price = :price AND #currency = :currency AND #frequency = :frequency",
          ExpressionAttributeNames: { "#currency": "currency", "#entityType": "entityType", "#frequency": "frequency", "#name": "name", "#pk": "PK", "#price": "price", "#status": "status" },
          ExpressionAttributeValues: { ":active": "ACTIVE", ":currency": membership.currency, ":frequency": membership.frequency, ":name": membership.planName, ":plan": "MembershipPlan", ":price": membership.expectedAmount },
          Key: primaryKeys.membershipPlan(membership.planId),
          TableName: this.table,
        },
      },
      putAbsent(this.table, this.toItem(membership, key)),
      putAbsent(this.table, this.dueView(membership, key)),
      putAbsent(this.table, this.statusView(membership, key)),
    ];
    if (membership.status === "ACTIVE") {
      actions.push(putAbsent(this.table, this.activePointer(membership, key)));
    }
    actions.push(this.auditAction(membership, input.auditId, input.correlationId, "MEMBERSHIP_CREATED"));

    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code === "TRANSACTION_CANCELLED" ||
        mapped.code === "CONDITIONAL_CHECK_FAILED"
      ) {
        throw membershipError(
          "MEMBERSHIP_CONFLICT",
          "La membresía no pudo crearse porque una condición vigente cambió.",
        );
      }
      throw mapped;
    }
    return membership;
  }

  async getById(
    userId: string,
    startDate: string,
    membershipId: string,
    consistentRead = true,
  ): Promise<Membership | undefined> {
    const key = primaryKeys.membership(
      financialId(userId, "userId"),
      financialDate(startDate, "startDate"),
      financialId(membershipId, "membershipId"),
    );
    const item = await this.base.get(key, consistentRead);
    return item === undefined ? undefined : this.readMembership(item, key);
  }

  async update(input: UpdateMembershipInput): Promise<Membership> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !isMembershipStatus(input.status)) {
      throw invalidDynamoDbInput("La versión o el estado de membresía no es válido.");
    }
    const current = await this.getById(input.userId, input.startDate, input.membershipId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "La membresía solicitada no existe.");
    }
    if (current.version !== input.expectedVersion) {
      throw membershipError("MEMBERSHIP_CONFLICT", "La membresía fue modificada por otra operación.");
    }
    if (current.status !== input.status && !canTransitionMembership(current.status, input.status)) {
      throw membershipError("MEMBERSHIP_CONFLICT", "La transición de estado no está permitida.");
    }
    const next = this.validateCreate({
      auditId: input.auditId,
      correlationId: input.correlationId,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
      currency: current.currency,
      endDate: input.endDate,
      expectedAmount: input.expectedAmount,
      frequency: current.frequency,
      membershipId: current.id,
      planId: current.planId,
      planName: current.planName,
      startDate: current.startDate,
      status: input.status,
      userId: current.userId,
    }, current.version + 1, input.updatedAt);
    if (next.updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a la versión vigente.");
    }
    const key = primaryKeys.membership(next.userId, next.startDate, next.id);
    const actions: TransactionAction[] = [
      {
        Put: {
          ConditionExpression: "attribute_exists(#pk) AND #version = :expectedVersion",
          ExpressionAttributeNames: { "#pk": "PK", "#version": "version" },
          ExpressionAttributeValues: { ":expectedVersion": current.version },
          Item: this.toItem(next, key),
          TableName: this.table,
        },
      },
      { Put: { Item: this.dueView(next, key), TableName: this.table } },
    ];
    if (next.status === "ACTIVE") {
      actions.push({
        ConditionCheck: {
          ConditionExpression: "attribute_exists(#pk) AND #entityType = :profile AND #status = :active AND contains(#roles, :student)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#pk": "PK", "#roles": "roles", "#status": "status" },
          ExpressionAttributeValues: { ":active": "ACTIVE", ":profile": "UserProfile", ":student": "STUDENT" },
          Key: primaryKeys.userProfile(next.userId),
          TableName: this.table,
        },
      });
    }
    if (current.status === next.status) {
      actions.push({ Put: { Item: this.statusView(next, key), TableName: this.table } });
    } else {
      actions.push({ Delete: { Key: primaryKeys.view("Membership", current.id, `STATUS_${current.status}`, current.userId), TableName: this.table } });
      actions.push(putAbsent(this.table, this.statusView(next, key)));
    }
    const pointerKey = primaryKeys.activeMembership(next.userId);
    if (current.status !== "ACTIVE" && next.status === "ACTIVE") {
      actions.push(putAbsent(this.table, this.activePointer(next, key)));
    } else if (current.status === "ACTIVE" && next.status === "ACTIVE") {
      actions.push({ Put: {
        ConditionExpression: "#canonicalPK = :canonicalPK AND #canonicalSK = :canonicalSK",
        ExpressionAttributeNames: { "#canonicalPK": "canonicalPK", "#canonicalSK": "canonicalSK" },
        ExpressionAttributeValues: { ":canonicalPK": key.PK, ":canonicalSK": key.SK },
        Item: this.activePointer(next, key),
        TableName: this.table,
      } });
    } else if (current.status === "ACTIVE") {
      actions.push({ Delete: {
        ConditionExpression: "#canonicalPK = :canonicalPK AND #canonicalSK = :canonicalSK",
        ExpressionAttributeNames: { "#canonicalPK": "canonicalPK", "#canonicalSK": "canonicalSK" },
        ExpressionAttributeValues: { ":canonicalPK": key.PK, ":canonicalSK": key.SK },
        Key: pointerKey,
        TableName: this.table,
      } });
    }
    actions.push(this.auditAction(
      next,
      input.auditId,
      input.correlationId,
      current.status === next.status ? "MEMBERSHIP_UPDATED" : `MEMBERSHIP_STATUS_${next.status}`,
      current,
      input.reason,
      input.actorId,
    ));
    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") {
        throw membershipError("MEMBERSHIP_CONFLICT", "La membresía cambió durante la operación.");
      }
      throw mapped;
    }
    return next;
  }

  destroy(): void {
    this.base.destroy();
  }

  async getActive(userId: string): Promise<Membership | undefined> {
    const pointerKey = primaryKeys.activeMembership(financialId(userId, "userId"));
    const pointer = await this.base.get(pointerKey, true);
    if (pointer === undefined) {
      return undefined;
    }
    const canonicalKey = this.readReference(pointer, pointerKey, "ACTIVE");
    const item = await this.base.get(canonicalKey, true);
    if (item === undefined) {
      throw membershipError(
        "MEMBERSHIP_RECORD_INVALID",
        "El puntero activo no tiene una membresía canónica.",
      );
    }
    const membership = this.readMembership(item, canonicalKey);
    if (membership.userId !== userId || membership.status !== "ACTIVE") {
      throw membershipError(
        "MEMBERSHIP_RECORD_INVALID",
        "El puntero activo no coincide con la membresía canónica.",
      );
    }
    return membership;
  }

  async listHistory(
    userId: string,
    options: {
      readonly consistentRead?: boolean;
      readonly cursor?: DynamoDbKey;
      readonly limit?: number;
    } = {},
  ): Promise<{ readonly memberships: readonly Membership[]; readonly cursor?: DynamoDbKey }> {
    const id = financialId(userId, "userId");
    const page = await this.base.queryPage({
      consistentRead: options.consistentRead ?? false,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit ?? 25,
      partitionValue: `USER#${id}`,
      sortKey: {
        from: "MEMBERSHIP#0000-00-00#",
        operation: "BETWEEN",
        to: "MEMBERSHIP#9999-99-99#\uffff",
      },
    });
    return {
      memberships: page.items.map((item) => this.readMembership(item, itemKey(item))),
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
    };
  }

  async listDue(
    dueDate: string,
    options: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number } = {},
  ): Promise<MembershipPage> {
    const date = financialDate(dueDate, "dueDate");
    return this.listFromViews(
      (shard) => `MEMBERSHIP_DUE#${date}#${shard}`,
      "DUE",
      options,
      (membership) => membership.endDate === date,
    );
  }

  async listByStatus(
    status: MembershipStatus,
    options: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number } = {},
  ): Promise<MembershipPage> {
    if (!isMembershipStatus(status)) {
      throw invalidDynamoDbInput("El estado de membresía no es válido.");
    }
    return this.listFromViews(
      (shard) => `MEMBERSHIP_STATUS#${status}#${shard}`,
      "STATUS",
      options,
      (membership) => membership.status === status,
    );
  }

  private activePointer(membership: Membership, canonicalKey: PrimaryKey): DynamoDbItem {
    return {
      ...primaryKeys.activeMembership(membership.userId),
      canonicalPK: canonicalKey.PK,
      canonicalSK: canonicalKey.SK,
      createdAt: membership.createdAt,
      entityType: "ActiveMembershipPointer",
      endDate: membership.endDate,
      endEpochDay: calendarEpochDay(membership.endDate),
      membershipId: membership.id,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      startDate: membership.startDate,
      startEpochDay: calendarEpochDay(membership.startDate),
      status: membership.status,
      updatedAt: membership.updatedAt,
      userId: membership.userId,
    };
  }

  private auditAction(
    membership: Membership,
    auditId: string,
    correlationId: string,
    action: string,
    previous?: Membership,
    reason?: string,
    actorId = membership.createdBy,
  ): TransactionAction {
    return new AuditLogRepository(this.document, this.table).createAppendAction({
      action,
      actorId,
      auditId,
      correlationId,
      details: {
        endDate: membership.endDate,
        expectedAmount: membership.expectedAmount,
        ...(previous === undefined ? {} : { fromStatus: previous.status }),
        ...(reason === undefined ? {} : { reason }),
        status: membership.status,
        version: membership.version,
      },
      result: "SUCCEEDED",
      targetId: membership.id,
      targetType: "Membership",
      timestamp: membership.updatedAt,
    }).action;
  }

  private dueView(membership: Membership, canonicalKey: PrimaryKey): DynamoDbItem {
    const index = operationalIndexKeys.membershipDue(
      membership.endDate,
      shardForId(membership.id),
      membership.id,
    );
    return this.view(membership, canonicalKey, "DUE", index);
  }

  private statusView(membership: Membership, canonicalKey: PrimaryKey): DynamoDbItem {
    const index = operationalIndexKeys.membershipStatus(
      membership.status,
      shardForId(membership.id),
      membership.endDate,
      membership.id,
    );
    return this.view(membership, canonicalKey, "STATUS", index);
  }

  private view(
    membership: Membership,
    canonicalKey: PrimaryKey,
    purpose: "DUE" | "STATUS",
    index: { readonly PK: string; readonly SK: string },
  ): DynamoDbItem {
    const viewPurpose = purpose === "STATUS"
      ? `STATUS_${membership.status}`
      : purpose;
    return {
      ...primaryKeys.view("Membership", membership.id, viewPurpose, membership.userId),
      GSI1PK: index.PK,
      GSI1SK: index.SK,
      canonicalPK: canonicalKey.PK,
      canonicalSK: canonicalKey.SK,
      createdAt: membership.createdAt,
      entityType: "View",
      purpose,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      targetType: "Membership",
      updatedAt: membership.updatedAt,
    };
  }

  private async listFromViews(
    partition: (shard: Shard) => string,
    purpose: "DUE" | "STATUS",
    options: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number },
    matches: (membership: Membership) => boolean,
  ): Promise<MembershipPage> {
    const limit = options.limitPerShard ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw invalidDynamoDbInput("El límite por shard debe estar entre 1 y 25.");
    }
    const expectedCursorKeys = [...SHARDS];
    const receivedCursors = options.cursors;
    if (receivedCursors !== undefined && (
      Object.keys(receivedCursors).length !== expectedCursorKeys.length ||
      expectedCursorKeys.some((key) => !(key in receivedCursors))
    )) {
      throw invalidDynamoDbInput("El cursor de membresías está incompleto.");
    }
    const pages = await Promise.all(
      SHARDS.map(async (shard) => {
        const cursor = options.cursors?.[shard];
        if (cursor === null) {
          return { page: { items: [] as readonly DynamoDbItem[] }, shard };
        }
        return {
          page: await this.base.queryPage({
            ...(cursor === undefined ? {} : { cursor }),
            indexName: "GSI1-Operational",
            limit,
            partitionValue: partition(shard),
          }),
          shard,
        };
      }),
    );
    const viewKeys = pages.flatMap(({ page }) => page.items.map(itemKey));
    const canonicalKeys = viewKeys.length === 0
      ? []
      : (await this.base.batchGet(viewKeys, true)).map((item) =>
          this.readReference(item, itemKey(item), purpose)
        );
    const memberships = canonicalKeys.length === 0
      ? []
      : (await this.base.batchGet(canonicalKeys, true))
          .map((item) => this.readMembership(item, itemKey(item)))
          .filter(matches)
          .sort((left, right) =>
            left.endDate.localeCompare(right.endDate) || left.id.localeCompare(right.id)
          );
    const hasNextPage = pages.some(({ page }) => page.nextCursor !== undefined);
    const cursors = Object.fromEntries(
      pages.map(({ page, shard }) => [shard, page.nextCursor ?? null]),
    );
    return {
      ...(hasNextPage ? { cursors } : {}),
      memberships,
    };
  }

  private readReference(
    item: DynamoDbItem,
    expectedKey: PrimaryKey,
    purpose: "ACTIVE" | "DUE" | "STATUS",
  ): PrimaryKey {
    const expectedType = purpose === "ACTIVE" ? "ActiveMembershipPointer" : "View";
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== expectedType ||
      (purpose !== "ACTIVE" && item.purpose !== purpose) ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.canonicalPK !== "string" ||
      typeof item.canonicalSK !== "string"
    ) {
      throw membershipError(
        "MEMBERSHIP_RECORD_INVALID",
        "La referencia persistida de membresía no es válida.",
      );
    }
    return { PK: item.canonicalPK, SK: item.canonicalSK };
  }

  private readMembership(item: DynamoDbItem, expectedKey: PrimaryKey): Membership {
    const expectedAmount = readFiniteNumber(item.expectedAmount);
    const version = readFiniteNumber(item.version);
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "Membership" ||
      readFiniteNumber(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.membershipId !== "string" ||
      typeof item.userId !== "string" ||
      typeof item.planId !== "string" ||
      typeof item.planName !== "string" ||
      typeof item.startDate !== "string" ||
      typeof item.endDate !== "string" ||
      typeof item.currency !== "string" ||
      typeof item.createdBy !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      !isMembershipStatus(item.status) ||
      !isFrequency(item.frequency) ||
      expectedAmount === undefined ||
      version === undefined
    ) {
      throw membershipError(
        "MEMBERSHIP_RECORD_INVALID",
        "La membresía persistida no es válida.",
      );
    }
    try {
      return this.validateCreate({
        auditId: "read-only",
        correlationId: "read-only",
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        currency: item.currency,
        endDate: item.endDate,
        expectedAmount,
        frequency: item.frequency,
        membershipId: item.membershipId,
        planId: item.planId,
        planName: item.planName,
        startDate: item.startDate,
        status: item.status,
        userId: item.userId,
      }, version, item.updatedAt);
    } catch {
      throw membershipError(
        "MEMBERSHIP_RECORD_INVALID",
        "La membresía persistida no es válida.",
      );
    }
  }

  private toItem(membership: Membership, key: PrimaryKey): MembershipItem {
    return {
      ...key,
      createdAt: membership.createdAt,
      createdBy: membership.createdBy,
      currency: membership.currency,
      endDate: membership.endDate,
      endEpochDay: calendarEpochDay(membership.endDate),
      entityType: "Membership",
      expectedAmount: membership.expectedAmount,
      frequency: membership.frequency,
      membershipId: membership.id,
      planId: membership.planId,
      planName: membership.planName,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      startDate: membership.startDate,
      startEpochDay: calendarEpochDay(membership.startDate),
      status: membership.status,
      updatedAt: membership.updatedAt,
      userId: membership.userId,
      version: membership.version,
    };
  }

  private validateCreate(
    input: CreateMembershipInput,
    version = 1,
    updatedAtInput = input.createdAt,
  ): Membership {
    if (!isMembershipStatus(input.status) || !isFrequency(input.frequency)) {
      throw invalidDynamoDbInput("El estado o frecuencia de membresía no es válido.");
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      throw invalidDynamoDbInput("La versión de membresía no es válida.");
    }
    const startDate = financialDate(input.startDate, "startDate");
    const endDate = financialDate(input.endDate, "endDate");
    if (endDate < startDate) {
      throw invalidDynamoDbInput("endDate no puede ser anterior a startDate.");
    }
    const createdAt = financialTimestamp(input.createdAt, "createdAt");
    const updatedAt = financialTimestamp(updatedAtInput, "updatedAt");
    if (updatedAt < createdAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior a createdAt.");
    }
    return {
      createdAt,
      createdBy: financialId(input.createdBy, "createdBy"),
      currency: financialCurrency(input.currency),
      endDate,
      expectedAmount: financialAmount(input.expectedAmount, "expectedAmount"),
      frequency: input.frequency,
      id: financialId(input.membershipId, "membershipId"),
      planId: financialId(input.planId, "planId"),
      planName: financialText(input.planName, "planName", 120),
      startDate,
      status: input.status,
      updatedAt,
      userId: financialId(input.userId, "userId"),
      version,
    };
  }
}
