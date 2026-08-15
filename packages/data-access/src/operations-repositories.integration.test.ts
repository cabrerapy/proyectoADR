import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AuditLogRepository,
  createDynamoDbAdapter,
  GalleryRepository,
  GymSettingsRepository,
  NotificationRepository,
  primaryKeys,
} from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-operations-${Date.now()}`;
const client = new DynamoDBClient({ credentials: { accessKeyId: "localplaceholder", secretAccessKey: "localplaceholder" }, endpoint: "http://127.0.0.1:8000", region: "local" });
const adapter = createDynamoDbAdapter({ environment: "local" });
const gallery = new GalleryRepository(adapter, tableName);
const notifications = new NotificationRepository(adapter, tableName);
const settings = new GymSettingsRepository(adapter, tableName);
const audit = new AuditLogRepository(adapter, tableName);

describe.skipIf(!enabled)("TASK-017 repositories with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(new CreateTableCommand({
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" }, { AttributeName: "GSI1SK", AttributeType: "S" },
        { AttributeName: "GSI2PK", AttributeType: "S" }, { AttributeName: "GSI2SK", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: [
        { IndexName: "GSI1-Operational", KeySchema: [{ AttributeName: "GSI1PK", KeyType: "HASH" }, { AttributeName: "GSI1SK", KeyType: "RANGE" }], Projection: { ProjectionType: "KEYS_ONLY" } },
        { IndexName: "GSI2-Relationships", KeySchema: [{ AttributeName: "GSI2PK", KeyType: "HASH" }, { AttributeName: "GSI2SK", KeyType: "RANGE" }], Projection: { ProjectionType: "KEYS_ONLY" } },
      ],
      KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
      TableName: tableName,
    }));
  });

  afterAll(async () => {
    if (enabled) await client.send(new DeleteTableCommand({ TableName: tableName }));
    adapter.destroy();
    client.destroy();
  });

  it("publishes only a consented ready derivative and never exposes its private original", async () => {
    await gallery.createAsset({ assetId: "asset-001", createdAt: "2026-08-08T12:00:00Z", createdBy: "admin-001", originalObjectKey: "private/originals/asset-001.jpg" });
    await gallery.createConsent({ assetId: "asset-001", consentId: "consent-001", createdAt: "2026-08-08T12:05:00Z", grantedBy: "student-001", status: "GRANTED" });
    await adapter.transactWrite({ TransactItems: [{ Update: { ConditionExpression: "#status = :uploading", ExpressionAttributeNames: { "#status": "status", "#updatedAt": "updatedAt", "#version": "version" }, ExpressionAttributeValues: { ":nextVersion": 2, ":ready": "READY", ":timestamp": "2026-08-08T12:10:00Z", ":uploading": "UPLOADING" }, Key: primaryKeys.galleryAsset("asset-001"), TableName: tableName, UpdateExpression: "SET #status = :ready, #updatedAt = :timestamp, #version = :nextVersion" } }] });
    await gallery.publish({ assetId: "asset-001", consentId: "consent-001", expectedVersion: 2, publicObjectKey: "public/watermarked/asset-001.webp", publishedAt: "2026-08-08T12:15:00Z" });
    const page = await gallery.listPublic("2026-08");
    expect(page.assets).toEqual([{ assetId: "asset-001", publicObjectKey: "public/watermarked/asset-001.webp", publishedAt: "2026-08-08T12:15:00Z" }]);
    expect(JSON.stringify(page)).not.toContain("private/originals");

    await gallery.createAsset({ assetId: "asset-002", createdAt: "2026-08-08T12:20:00Z", createdBy: "admin-001", originalObjectKey: "private/originals/asset-002.jpg" });
    await gallery.createConsent({ assetId: "asset-002", consentId: "consent-002", createdAt: "2026-08-08T12:21:00Z", grantedBy: "student-002", status: "REVOKED" });
    await adapter.transactWrite({ TransactItems: [{ Update: { ExpressionAttributeNames: { "#status": "status", "#version": "version" }, ExpressionAttributeValues: { ":nextVersion": 2, ":ready": "READY" }, Key: primaryKeys.galleryAsset("asset-002"), TableName: tableName, UpdateExpression: "SET #status = :ready, #version = :nextVersion" } }] });
    await expect(gallery.publish({ assetId: "asset-002", consentId: "consent-002", expectedVersion: 2, publicObjectKey: "public/watermarked/asset-002.webp", publishedAt: "2026-08-08T12:25:00Z" })).rejects.toMatchObject({ code: "TRANSACTION_CANCELLED" });
  });

  it("creates one idempotent private upload asset and rejects a changed payload", async () => {
    const input = {
      assetId: "asset-upload-001",
      contentType: "image/jpeg",
      createdAt: "2026-08-14T12:00:00Z",
      createdBy: "staff-upload-001",
      fileName: "entrenamiento.jpg",
      originalObjectKey: "gallery/originals/asset-upload-001.jpg",
      requestKey: "request-upload-001",
      size: 4,
    } as const;
    const results = await Promise.all(Array.from({ length: 8 }, () => gallery.createUpload(input)));
    expect(results.filter(({ disposition }) => disposition === "CREATED")).toHaveLength(1);
    expect(results.every(({ asset }) => asset.id === input.assetId && asset.status === "UPLOADING")).toBe(true);
    await expect(gallery.createUpload({ ...input, assetId: "asset-upload-002", size: 5 }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deduplicates reminders and lists pending work through GSI1", async () => {
    const input = { createdAt: "2026-08-08T13:00:00Z", dueDate: "2026-08-13", membershipId: "membership-001", notificationId: "notification-001", recipientUserId: "student-001", scheduledAt: "2026-08-08T13:05:00Z", type: "MEMBERSHIP_EXPIRY" as const };
    const first = await notifications.createReminder(input);
    const replay = await notifications.createReminder(input);
    expect(replay).toEqual(first);
    const pending = await notifications.listPending("2026-08-08");
    expect(pending.notifications.map(({ id }) => id)).toContain("notification-001");
    await expect(notifications.createReminder({ ...input, recipientUserId: "student-002" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("uses conditional versions for settings and append-only audit queries", async () => {
    await settings.create({ cancellationWindowMinutes: 120, currency: "PYG", gymName: "Gym ADR", timezone: "America/Asuncion", updatedAt: "2026-08-08T14:00:00Z", updatedBy: "admin-001", whatsappNumber: "+595981000000" });
    const updated = await settings.update({ cancellationWindowMinutes: 180, currency: "PYG", expectedVersion: 1, gymName: "Gym ADR", timezone: "America/Asuncion", updatedAt: "2026-08-08T14:05:00Z", updatedBy: "admin-001" });
    expect(updated.version).toBe(2);
    await expect(settings.update({ cancellationWindowMinutes: 60, currency: "PYG", expectedVersion: 1, gymName: "Gym ADR", timezone: "America/Asuncion", updatedAt: "2026-08-08T14:10:00Z", updatedBy: "admin-002" })).rejects.toMatchObject({ code: "TRANSACTION_CANCELLED" });

    await audit.append({ action: "SETTINGS_UPDATED", actorId: "admin-001", auditId: "audit-001", correlationId: "request-001", details: { cancellationWindowMinutes: 180 }, result: "SUCCEEDED", targetId: "gym", targetType: "GymSettings", timestamp: "2026-08-08T14:05:00Z" });
    await expect(audit.append({ action: "SETTINGS_UPDATED", actorId: "admin-001", auditId: "audit-001", correlationId: "request-001", result: "SUCCEEDED", targetId: "gym", targetType: "GymSettings", timestamp: "2026-08-08T14:05:00Z" })).rejects.toMatchObject({ code: "CONDITIONAL_CHECK_FAILED" });
    const byEntity = await audit.listByEntity("GymSettings", "gym", "2026-08-08T00:00:00Z", "2026-08-08T23:59:59Z");
    const byActor = await audit.listByActor("admin-001", "2026-08-08T00:00:00Z", "2026-08-08T23:59:59Z");
    expect(byEntity.entries).toHaveLength(1);
    expect(byActor.entries).toHaveLength(1);
  });
});
