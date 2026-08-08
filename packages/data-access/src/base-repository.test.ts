import { describe, expect, it, vi } from "vitest";

import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort } from "./dynamodb-adapter";
import { DynamoDbRepositoryError } from "./dynamodb-errors";

const metadata = { httpStatusCode: 200 };

const createPort = (): DynamoDbDocumentPort => ({
  batchGet: vi.fn(async () => ({ $metadata: metadata })),
  destroy: vi.fn(),
  get: vi.fn(async () => ({ $metadata: metadata })),
  put: vi.fn(async () => ({ $metadata: metadata })),
  query: vi.fn(async () => ({ $metadata: metadata })),
  transactWrite: vi.fn(async () => ({ $metadata: metadata })),
});

describe("BaseDynamoDbRepository", () => {
  it("gets a canonical item with optional strong consistency", async () => {
    const port = createPort();
    vi.mocked(port.get).mockResolvedValueOnce({
      $metadata: metadata,
      Item: { PK: "USER#u1", SK: "PROFILE", entityType: "UserProfile" },
    });
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    const item = await repository.get(
      { PK: "USER#u1", SK: "PROFILE" },
      true,
    );

    expect(item).toMatchObject({ entityType: "UserProfile" });
    expect(port.get).toHaveBeenCalledWith({
      ConsistentRead: true,
      Key: { PK: "USER#u1", SK: "PROFILE" },
      TableName: "gym-adr-platform-local",
    });
  });

  it("builds a base-table query and returns its pagination key", async () => {
    const port = createPort();
    const cursor = { PK: "USER#u1", SK: "MEMBERSHIP#2026-01-01#m1" };
    vi.mocked(port.query).mockResolvedValueOnce({
      $metadata: metadata,
      Items: [{ PK: "USER#u1", SK: "MEMBERSHIP#2026-01-01#m1" }],
      LastEvaluatedKey: cursor,
    });
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    const page = await repository.queryPage({
      consistentRead: true,
      limit: 20,
      partitionValue: "USER#u1",
      sortKey: { operation: "BEGINS_WITH", value: "MEMBERSHIP#" },
    });

    expect(page.nextCursor).toEqual(cursor);
    expect(port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        ConsistentRead: true,
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        ExpressionAttributeValues: {
          ":partitionValue": "USER#u1",
          ":sortValue": "MEMBERSHIP#",
        },
        KeyConditionExpression:
          "#pk = :partitionValue AND begins_with(#sk, :sortValue)",
        Limit: 20,
      }),
    );
  });

  it("queries an approved GSI with eventual consistency", async () => {
    const port = createPort();
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    await repository.queryPage({
      indexName: "GSI1-Operational",
      partitionValue: "USER_STATUS#ACTIVE#S00",
      sortKey: {
        from: "CREATED#2026-01-01T00:00:00Z",
        operation: "BETWEEN",
        to: "CREATED#2026-12-31T23:59:59Z",
      },
    });

    expect(port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        ConsistentRead: false,
        ExpressionAttributeNames: {
          "#pk": "GSI1PK",
          "#sk": "GSI1SK",
        },
        IndexName: "GSI1-Operational",
      }),
    );
  });

  it("rejects strong consistency on a GSI before sending a command", async () => {
    const port = createPort();
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    await expect(
      repository.queryPage({
        consistentRead: true,
        indexName: "GSI2-Relationships",
        partitionValue: "USER#u1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(port.query).not.toHaveBeenCalled();
  });

  it("rejects empty or inverted sort conditions before querying", async () => {
    const port = createPort();
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    await expect(
      repository.queryPage({
        partitionValue: "USER#u1",
        sortKey: { operation: "BEGINS_WITH", value: "" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.queryPage({
        partitionValue: "USER#u1",
        sortKey: { from: "Z", operation: "BETWEEN", to: "A" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(port.query).not.toHaveBeenCalled();
  });

  it("retries only the unprocessed BatchGet keys", async () => {
    const port = createPort();
    const retryDelay = vi.fn(async () => undefined);
    vi.mocked(port.batchGet)
      .mockResolvedValueOnce({
        $metadata: metadata,
        Responses: {
          "gym-adr-platform-local": [{ PK: "USER#u1", SK: "PROFILE" }],
        },
        UnprocessedKeys: {
          "gym-adr-platform-local": {
            Keys: [{ PK: "USER#u2", SK: "PROFILE" }],
          },
        },
      })
      .mockResolvedValueOnce({
        $metadata: metadata,
        Responses: {
          "gym-adr-platform-local": [{ PK: "USER#u2", SK: "PROFILE" }],
        },
      });
    const repository = new BaseDynamoDbRepository(port, {
      retryDelay,
      tableName: "gym-adr-platform-local",
    });

    const items = await repository.batchGet([
      { PK: "USER#u1", SK: "PROFILE" },
      { PK: "USER#u2", SK: "PROFILE" },
    ]);

    expect(items).toHaveLength(2);
    expect(retryDelay).toHaveBeenCalledOnce();
    expect(port.batchGet).toHaveBeenNthCalledWith(2, {
      RequestItems: {
        "gym-adr-platform-local": {
          ConsistentRead: false,
          Keys: [{ PK: "USER#u2", SK: "PROFILE" }],
        },
      },
    });
  });

  it("fails safely when BatchGet exhausts controlled retries", async () => {
    const port = createPort();
    vi.mocked(port.batchGet).mockResolvedValue({
      $metadata: metadata,
      UnprocessedKeys: {
        "gym-adr-platform-local": {
          Keys: [{ PK: "USER#u1", SK: "PROFILE" }],
        },
      },
    });
    const repository = new BaseDynamoDbRepository(port, {
      batchGetAttempts: 2,
      retryDelay: async () => undefined,
      tableName: "gym-adr-platform-local",
    });

    await expect(
      repository.batchGet([{ PK: "USER#u1", SK: "PROFILE" }]),
    ).rejects.toMatchObject({ code: "UNPROCESSED_KEYS", retryable: true });
    expect(port.batchGet).toHaveBeenCalledTimes(2);
  });

  it.each([0, 101])("rejects an invalid BatchGet size of %s", async (size) => {
    const port = createPort();
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });
    const keys = Array.from({ length: size }, (_, index) => ({
      PK: `USER#${index}`,
      SK: "PROFILE",
    }));

    await expect(repository.batchGet(keys)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(port.batchGet).not.toHaveBeenCalled();
  });

  it("maps SDK failures to sanitized typed errors", async () => {
    const port = createPort();
    vi.mocked(port.get).mockRejectedValueOnce(
      Object.assign(new Error("sensitive upstream details"), {
        name: "ProvisionedThroughputExceededException",
      }),
    );
    const repository = new BaseDynamoDbRepository(port, {
      tableName: "gym-adr-platform-local",
    });

    const operation = repository.get({ PK: "USER#u1", SK: "PROFILE" });
    await expect(operation).rejects.toBeInstanceOf(DynamoDbRepositoryError);
    await expect(operation).rejects.toMatchObject({
      code: "THROTTLED",
      retryable: true,
    });
    await expect(operation).rejects.not.toThrow("sensitive upstream details");
  });
});
