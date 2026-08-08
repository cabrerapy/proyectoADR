import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { AuditLogRepository } from "./audit-log-repository";
import { assertDynamoDbCommandAllowed, type DynamoDbDocumentPort } from "./dynamodb-adapter";
import { GalleryRepository } from "./gallery-repository";
import { GymSettingsRepository } from "./gym-settings-repository";
import { NotificationRepository } from "./notification-repository";

const metadata = { httpStatusCode: 200 };
const port = (): DynamoDbDocumentPort => ({
  batchGet: vi.fn(async () => ({ $metadata: metadata })),
  destroy: vi.fn(),
  get: vi.fn(async () => ({ $metadata: metadata })),
  put: vi.fn(async () => ({ $metadata: metadata })),
  query: vi.fn(async () => ({ $metadata: metadata })),
  transactWrite: vi.fn(async () => ({ $metadata: metadata })),
});

describe("TASK-017 persistence guards", () => {
  it("rejects ScanCommand explicitly", () => {
    expect(() => assertDynamoDbCommandAllowed(new ScanCommand({ TableName: "gym-adr-platform-local" }))).toThrow("ScanCommand está prohibido");
  });

  it("fans pending notifications out through the four approved GSI partitions", async () => {
    const document = port();
    await new NotificationRepository(document, "gym-adr-platform-local").listPending("2026-08-13");
    expect(document.query).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(document.query).mock.calls) {
      expect(call[0]).toMatchObject({ IndexName: "GSI1-Operational", ConsistentRead: false });
      expect(call[0].KeyConditionExpression).toContain("#pk = :partitionValue");
    }
  });

  it("queries every public gallery shard by PK without an index or Scan", async () => {
    const document = port();
    await new GalleryRepository(document, "gym-adr-platform-local").listPublic("2026-08");
    expect(document.query).toHaveBeenCalledTimes(4);
    expect(document.query).toHaveBeenCalledWith(expect.objectContaining({ IndexName: undefined, KeyConditionExpression: expect.stringContaining("begins_with") }));
  });

  it("rejects sensitive audit detail fields before persistence", async () => {
    const document = port();
    await expect(new AuditLogRepository(document, "gym-adr-platform-local").append({ action: "PAYMENT_VOID", actorId: "admin-1", auditId: "audit-1", correlationId: "request-1", details: { accessToken: "must-not-persist" }, result: "SUCCEEDED", targetId: "payment-1", targetType: "Payment", timestamp: "2026-08-08T12:00:00Z" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(document.put).not.toHaveBeenCalled();
  });

  it("accepts only explicit public settings and Paraguay MVP defaults", async () => {
    const document = port();
    const repository = new GymSettingsRepository(document, "gym-adr-platform-local");
    await expect(repository.create({ cancellationWindowMinutes: 120, currency: "PYG", gymName: "Gym ADR", timezone: "UTC", updatedAt: "2026-08-08T12:00:00Z", updatedBy: "admin-1" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(document.put).not.toHaveBeenCalled();
  });
});
