import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDynamoDbAdapter,
  IdempotencyRepository,
  primaryKeys,
} from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-idempotency-${Date.now()}`;
const client = new DynamoDBClient({
  credentials: {
    accessKeyId: "localplaceholder",
    secretAccessKey: "localplaceholder",
  },
  endpoint: "http://127.0.0.1:8000",
  region: "local",
});
const adapter = createDynamoDbAdapter({ environment: "local" });
const repository = new IdempotencyRepository(adapter, tableName);

const input = {
  createdAt: "2026-08-05T20:00:00Z",
  operation: "PAYMENT",
  payload: { amount: 150_000, currency: "PYG", membershipId: "membership1" },
  requestKey: "request1",
  result: { paymentId: "payment1", status: "CONFIRMED" },
  retention: { kind: "DURABLE" },
  subjectId: "student1",
} as const;

describe.skipIf(!enabled)("IdempotencyRepository with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        TableName: tableName,
      }),
    );
  });

  afterAll(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      adapter.destroy();
      client.destroy();
    }
  });

  it("persists one winner and replays it under concurrent retries", async () => {
    const effect = {
      Put: {
        ConditionExpression:
          "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        Item: { PK: "PAYMENT#payment1", SK: "METADATA", status: "CONFIRMED" },
        TableName: tableName,
      },
    } as const;
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        repository.transactOrReplay(input, [effect])
      ),
    );

    expect(results.filter(({ disposition }) => disposition === "CREATED"))
      .toHaveLength(1);
    expect(results.filter(({ disposition }) => disposition === "REPLAYED"))
      .toHaveLength(15);
    for (const { result } of results) {
      expect(result).toEqual(input.result);
    }

    const key = primaryKeys.idempotency("PAYMENT", "student1", "request1");
    await expect(adapter.get({
      ConsistentRead: true,
      Key: key,
      TableName: tableName,
    })).resolves.toMatchObject({ Item: { ...key, entityType: "Idempotency" } });
    await expect(adapter.get({
      ConsistentRead: true,
      Key: { PK: "PAYMENT#payment1", SK: "METADATA" },
      TableName: tableName,
    })).resolves.toMatchObject({ Item: { status: "CONFIRMED" } });
  });

  it("rejects a different payload without replacing the first result", async () => {
    await expect(
      repository.transactOrReplay(
        {
          ...input,
          payload: { amount: 200_000, currency: "PYG", membershipId: "membership1" },
        },
        [{
          Put: {
            Item: { PK: "PAYMENT#payment1", SK: "METADATA" },
            TableName: tableName,
          },
        }],
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    await expect(repository.recordOrReplay(input)).resolves.toEqual({
      disposition: "REPLAYED",
      result: input.result,
    });
  });
});
