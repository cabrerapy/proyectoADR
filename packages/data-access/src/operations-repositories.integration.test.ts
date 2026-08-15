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

    await gallery.hide({ assetId: "asset-001", expectedVersion: 3, hiddenAt: "2026-08-08T12:16:00Z" });
    await expect(gallery.listPublic("2026-08")).resolves.toEqual({ assets: [] });
    await expect(gallery.getAsset("asset-001")).resolves.toMatchObject({ status: "HIDDEN", version: 4 });

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

  it("claims image processing conditionally and replays completed or permanent outcomes", async () => {
    await gallery.createAsset({ assetId: "asset-process-001", createdAt: "2026-08-14T13:00:00Z", createdBy: "admin-001", originalObjectKey: "gallery/originals/asset-process-001.jpg" });
    const claim = { assetId: "asset-process-001", originalObjectKey: "gallery/originals/asset-process-001.jpg", processedAt: "2026-08-14T13:01:00Z", sourceIdentity: "source-001" } as const;
    const competing = await Promise.allSettled([gallery.startProcessing(claim), gallery.startProcessing(claim)]);
    expect(competing.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const retry = await gallery.startProcessing({ ...claim, processedAt: "2026-08-14T13:02:00Z" });
    expect(retry).toEqual({ disposition: "PROCESS", processingVersion: 3 });
    await gallery.completeProcessing({ assetId: claim.assetId, derivativeObjectKeys: ["gallery/derived/asset-process-001/480.webp", "gallery/derived/asset-process-001/960.webp"], expectedVersion: 3, processedAt: "2026-08-14T13:03:00Z", sourceIdentity: claim.sourceIdentity });
    await expect(gallery.startProcessing({ ...claim, processedAt: "2026-08-14T13:04:00Z" })).resolves.toEqual({ disposition: "READY" });
    expect(await gallery.getAsset(claim.assetId)).toMatchObject({ publicObjectKey: "gallery/derived/asset-process-001/960.webp", status: "READY", version: 4 });

    await gallery.createAsset({ assetId: "asset-process-002", createdAt: "2026-08-14T13:05:00Z", createdBy: "admin-001", originalObjectKey: "gallery/originals/asset-process-002.png" });
    const failedClaim = { assetId: "asset-process-002", originalObjectKey: "gallery/originals/asset-process-002.png", processedAt: "2026-08-14T13:06:00Z", sourceIdentity: "source-002" } as const;
    const started = await gallery.startProcessing(failedClaim);
    await gallery.failProcessing({ assetId: failedClaim.assetId, expectedVersion: started.processingVersion ?? 0, failureCode: "CORRUPT_IMAGE", processedAt: "2026-08-14T13:07:00Z", sourceIdentity: failedClaim.sourceIdentity });
    await expect(gallery.startProcessing({ ...failedClaim, processedAt: "2026-08-14T13:08:00Z" })).resolves.toEqual({ disposition: "PERMANENT_FAILURE" });
    expect(await gallery.getAsset(failedClaim.assetId)).toMatchObject({ status: "FAILED", version: 3 });
  });

  it("deduplicates reminders and lists pending work through GSI1", async () => {
    const input = { createdAt: "2026-08-08T13:00:00Z", dueDate: "2026-08-13", membershipId: "membership-001", notificationId: "notification-001", recipientUserId: "student-001", scheduledAt: "2026-08-08T13:05:00Z", type: "MEMBERSHIP_EXPIRY" as const };
    const first = await notifications.createReminder(input);
    const replay = await notifications.createReminder(input);
    expect(replay).toEqual(first);
    const pending = await notifications.listPending("2026-08-08");
    expect(pending.notifications.map(({ id }) => id)).toContain("notification-001");
    await expect(notifications.createReminder({ ...input, recipientUserId: "student-002" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const leased = await notifications.acquireLease({ expectedVersion: 1, leaseOwner: "worker-001", leaseUntil: "2026-08-08T13:10:00Z", notificationId: input.notificationId, startedAt: input.scheduledAt });
    expect(leased).toMatchObject({ attempts: 1, status: "PROCESSING", version: 2 });
    await expect(notifications.acquireLease({ expectedVersion: 1, leaseOwner: "worker-002", leaseUntil: "2026-08-08T13:10:00Z", notificationId: input.notificationId, startedAt: input.scheduledAt })).rejects.toMatchObject({ code: "TRANSACTION_CANCELLED" });
    const retry = await notifications.completeAttempt({ attemptId: "attempt-001", completedAt: "2026-08-08T13:06:00Z", errorCode: "TRANSIENT", expectedVersion: 2, leaseOwner: "worker-001", notificationId: input.notificationId, retryAt: "2026-08-08T13:08:00Z" });
    expect(retry).toMatchObject({ errorCode: "TRANSIENT", nextAttemptAt: "2026-08-08T13:08:00Z", status: "PENDING", version: 3 });
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
