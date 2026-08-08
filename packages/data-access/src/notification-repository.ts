import {
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationStatus,
  type NotificationType,
} from "@gym-adr/domain";

import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem, DynamoDbKey } from "./dynamodb-adapter";
import { DynamoDbRepositoryError, invalidDynamoDbInput, mapDynamoDbError } from "./dynamodb-errors";
import { readFiniteNumber, tableName } from "./financial-validation";
import { operationalIndexKeys, primaryKeys } from "./model-keys";
import { SHARDS, shardForId } from "./model-shards";
import { CURRENT_SCHEMA_VERSION, type PrimaryKey } from "./model-types";
import { operationDate, operationId, operationTimestamp } from "./operations-validation";

export interface CreateReminderInput {
  readonly createdAt: string;
  readonly dueDate: string;
  readonly membershipId: string;
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly scheduledAt: string;
  readonly type: NotificationType;
}

export interface NotificationPage {
  readonly cursors?: Readonly<Record<string, DynamoDbKey | undefined>>;
  readonly notifications: readonly Notification[];
}

const isStatus = (value: unknown): value is NotificationStatus =>
  typeof value === "string" && NOTIFICATION_STATUSES.some((status) => status === value);
const isType = (value: unknown): value is NotificationType =>
  typeof value === "string" && NOTIFICATION_TYPES.some((type) => type === value);
const itemKey = (item: DynamoDbItem): PrimaryKey => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") throw invalidDynamoDbInput("La clave de notificación no es válida.");
  return { PK: item.PK, SK: item.SK };
};

export class NotificationRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;
  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async createReminder(input: CreateReminderInput): Promise<Notification> {
    const notification = this.validate(input);
    const key = primaryKeys.notification(notification.id);
    const dedupeKey = primaryKeys.reminderIdempotency(notification.membershipId, notification.type, notification.dueDate);
    const index = operationalIndexKeys.notificationPending(notification.scheduledAt.slice(0, 10), shardForId(notification.id), notification.scheduledAt, notification.id);
    const condition = "attribute_not_exists(#pk) AND attribute_not_exists(#sk)";
    const names = { "#pk": "PK", "#sk": "SK" };
    try {
      await this.document.transactWrite({ TransactItems: [
        { Put: { ConditionExpression: condition, ExpressionAttributeNames: names, Item: { ...key, GSI1PK: index.PK, GSI1SK: index.SK, ...notification, entityType: "Notification", notificationId: notification.id, schemaVersion: CURRENT_SCHEMA_VERSION }, TableName: this.table } },
        { Put: { ConditionExpression: condition, ExpressionAttributeNames: names, Item: { ...dedupeKey, createdAt: notification.createdAt, dueDate: notification.dueDate, entityType: "Idempotency", membershipId: notification.membershipId, notificationId: notification.id, recipientUserId: notification.recipientUserId, reminderType: notification.type, scheduledAt: notification.scheduledAt, schemaVersion: CURRENT_SCHEMA_VERSION }, TableName: this.table } },
      ] });
      return notification;
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code !== "TRANSACTION_CANCELLED" && mapped.code !== "CONDITIONAL_CHECK_FAILED") throw mapped;
      const existingDedupe = await this.base.get(dedupeKey, true);
      if (existingDedupe === undefined || existingDedupe.notificationId !== notification.id || existingDedupe.recipientUserId !== notification.recipientUserId || existingDedupe.scheduledAt !== notification.scheduledAt) {
        throw new DynamoDbRepositoryError("IDEMPOTENCY_CONFLICT", "El recordatorio ya fue registrado con datos diferentes.");
      }
      const existing = await this.base.get(key, true);
      if (existing === undefined) throw new DynamoDbRepositoryError("IDEMPOTENCY_RECORD_INVALID", "El recordatorio idempotente no tiene notificación canónica.");
      return this.read(existing);
    }
  }

  async listPending(scheduledDate: string, options: { readonly cursors?: Readonly<Record<string, DynamoDbKey | undefined>>; readonly limitPerShard?: number } = {}): Promise<NotificationPage> {
    const date = operationDate(scheduledDate, "scheduledDate");
    const pages = await Promise.all(SHARDS.map(async (shard) => ({ shard, page: await this.base.queryPage({ ...(options.cursors?.[shard] === undefined ? {} : { cursor: options.cursors[shard] }), indexName: "GSI1-Operational", limit: options.limitPerShard ?? 25, partitionValue: `NOTIFICATION#PENDING#${date}#${shard}` }) })));
    const keys = pages.flatMap(({ page }) => page.items.map(itemKey));
    const notifications = keys.length === 0 ? [] : (await this.base.batchGet(keys, true)).map((item) => this.read(item)).filter((item) => item.status === "PENDING" && item.scheduledAt.slice(0, 10) === date).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
    const cursors = Object.fromEntries(pages.map(({ page, shard }) => [shard, page.nextCursor]));
    return { notifications, ...(Object.values(cursors).some(Boolean) ? { cursors } : {}) };
  }

  private validate(input: CreateReminderInput): Notification {
    if (input.type !== "MEMBERSHIP_EXPIRY" && input.type !== "OVERDUE_MEMBERSHIP") throw invalidDynamoDbInput("El tipo no corresponde a un recordatorio de membresía.");
    const createdAt = operationTimestamp(input.createdAt, "createdAt");
    const scheduledAt = operationTimestamp(input.scheduledAt, "scheduledAt");
    return { createdAt, dueDate: operationDate(input.dueDate, "dueDate"), id: operationId(input.notificationId, "notificationId"), membershipId: operationId(input.membershipId, "membershipId"), recipientUserId: operationId(input.recipientUserId, "recipientUserId"), scheduledAt, status: "PENDING", type: input.type, updatedAt: createdAt, version: 1 };
  }

  private read(item: DynamoDbItem): Notification {
    const version = readFiniteNumber(item.version);
    if (item.entityType !== "Notification" || typeof item.notificationId !== "string" || typeof item.createdAt !== "string" || typeof item.dueDate !== "string" || typeof item.membershipId !== "string" || typeof item.recipientUserId !== "string" || typeof item.scheduledAt !== "string" || typeof item.updatedAt !== "string" || version === undefined || !isStatus(item.status) || !isType(item.type)) throw invalidDynamoDbInput("La notificación persistida no es válida.");
    return { createdAt: item.createdAt, dueDate: item.dueDate, id: item.notificationId, membershipId: item.membershipId, recipientUserId: item.recipientUserId, scheduledAt: item.scheduledAt, status: item.status, type: item.type, updatedAt: item.updatedAt, version };
  }
}
