import type {
  BatchGetCommandInput,
  BatchGetCommandOutput,
  GetCommandInput,
  GetCommandOutput,
  PutCommandInput,
  PutCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  TransactWriteCommandInput,
  TransactWriteCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import type { DynamoDbDocumentPort } from "./dynamodb-adapter";
import { KEY_CODECS } from "./model-codecs";
import {
  hashIdempotencyPayload,
  IdempotencyRepository,
  type JsonValue,
  type RecordIdempotencyInput,
} from "./idempotency-repository";

const metadata = { httpStatusCode: 200 };

class MemoryDocumentPort implements DynamoDbDocumentPort {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly puts: PutCommandInput[] = [];

  async batchGet(_input: BatchGetCommandInput): Promise<BatchGetCommandOutput> {
    return { $metadata: metadata };
  }

  destroy(): void {}

  async get(input: GetCommandInput): Promise<GetCommandOutput> {
    const key = input.Key;
    return {
      $metadata: metadata,
      Item: key === undefined
        ? undefined
        : this.items.get(`${String(key.PK)}\u0000${String(key.SK)}`),
    };
  }

  async put(input: PutCommandInput): Promise<PutCommandOutput> {
    this.puts.push(input);
    const item = input.Item;
    if (item === undefined) {
      throw new Error("missing item");
    }
    const storageKey = `${String(item.PK)}\u0000${String(item.SK)}`;
    if (this.items.has(storageKey)) {
      throw Object.assign(new Error("raw conditional details"), {
        name: "ConditionalCheckFailedException",
      });
    }
    this.items.set(storageKey, item);
    return { $metadata: metadata };
  }

  async query(_input: QueryCommandInput): Promise<QueryCommandOutput> {
    return { $metadata: metadata };
  }

  async transactWrite(
    input: TransactWriteCommandInput,
  ): Promise<TransactWriteCommandOutput> {
    const writes = (input.TransactItems ?? []).map(({ Put }) => {
      if (Put?.Item === undefined) {
        throw new Error("unsupported transaction action");
      }
      return {
        item: Put.Item,
        key: `${String(Put.Item.PK)}\u0000${String(Put.Item.SK)}`,
      };
    });
    if (writes.some(({ key }) => this.items.has(key))) {
      throw Object.assign(new Error("raw transaction details"), {
        name: "TransactionCanceledException",
      });
    }
    for (const { item, key } of writes) {
      this.items.set(key, item);
    }
    return { $metadata: metadata };
  }
}

const baseInput = {
  createdAt: "2026-08-05T20:00:00Z",
  operation: "BOOKING",
  payload: { classId: "class1", studentId: "student1" },
  requestKey: "request1",
  result: { reservationId: "reservation1", status: "CONFIRMED" },
  retention: { kind: "DURABLE" },
  subjectId: "student1",
} as const satisfies RecordIdempotencyInput;

describe("IdempotencyRepository", () => {
  it("hashes equivalent JSON objects deterministically", () => {
    expect(hashIdempotencyPayload({ a: 1, b: [true, null] })).toBe(
      hashIdempotencyPayload({ b: [true, null], a: 1 }),
    );
  });

  it("round-trips the request idempotency key without PII", () => {
    const input = {
      kind: "REQUEST",
      operation: "BOOKING",
      requestKey: "request1",
      subjectId: "student1",
    } as const;
    const key = KEY_CODECS.Idempotency.encode(input);

    expect(key).toEqual({
      PK: "IDEMPOTENCY#BOOKING#student1",
      SK: "REQUEST#request1",
    });
    expect(KEY_CODECS.Idempotency.decode(key)).toEqual(input);
  });

  it("creates once and replays the persisted result for the same payload", async () => {
    const port = new MemoryDocumentPort();
    const repository = new IdempotencyRepository(
      port,
      "gym-adr-platform-local",
    );

    await expect(repository.recordOrReplay(baseInput)).resolves.toEqual({
      disposition: "CREATED",
      result: baseInput.result,
    });
    await expect(
      repository.recordOrReplay({
        ...baseInput,
        result: { reservationId: "ignored", status: "CONFIRMED" },
      }),
    ).resolves.toEqual({
      disposition: "REPLAYED",
      result: baseInput.result,
    });

    expect(port.puts[0]?.ConditionExpression).toContain(
      "attribute_not_exists",
    );
  });

  it("preserves a JSON object whose property is named value", async () => {
    const repository = new IdempotencyRepository(
      new MemoryDocumentPort(),
      "gym-adr-platform-local",
    );
    const input = { ...baseInput, requestKey: "requestValue", result: { value: "1" } };

    await repository.recordOrReplay(input);
    await expect(repository.recordOrReplay(input)).resolves.toEqual({
      disposition: "REPLAYED",
      result: { value: "1" },
    });
  });

  it("rejects reuse of a key with a different payload", async () => {
    const repository = new IdempotencyRepository(
      new MemoryDocumentPort(),
      "gym-adr-platform-local",
    );
    await repository.recordOrReplay(baseInput);

    await expect(
      repository.recordOrReplay({
        ...baseInput,
        payload: { classId: "anotherClass", studentId: "student1" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("allows one concurrent creator and replays the winner to every caller", async () => {
    const repository = new IdempotencyRepository(
      new MemoryDocumentPort(),
      "gym-adr-platform-local",
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repository.recordOrReplay(baseInput)),
    );

    expect(results.filter(({ disposition }) => disposition === "CREATED"))
      .toHaveLength(1);
    for (const { result } of results) {
      expect(result).toEqual(baseInput.result);
    }
  });

  it("writes TTL only for explicitly ephemeral records", async () => {
    const port = new MemoryDocumentPort();
    const repository = new IdempotencyRepository(
      port,
      "gym-adr-platform-local",
    );
    await repository.recordOrReplay(baseInput);
    await repository.recordOrReplay({
      ...baseInput,
      operation: "IMAGE",
      requestKey: "request2",
      retention: { expiresAtEpochSeconds: 1_807_000_000, kind: "EPHEMERAL" },
    });

    expect(port.puts[0]?.Item).not.toHaveProperty("expiresAt");
    expect(port.puts[1]?.Item).toMatchObject({ expiresAt: 1_807_000_000 });
  });

  it("commits the business effect and idempotency in one transaction", async () => {
    const port = new MemoryDocumentPort();
    const repository = new IdempotencyRepository(
      port,
      "gym-adr-platform-local",
    );
    const action = {
      Put: {
        ConditionExpression: "attribute_not_exists(PK)",
        Item: { PK: "EFFECT#1", SK: "METADATA", value: "created" },
        TableName: "gym-adr-platform-local",
      },
    } as const;

    await expect(repository.transactOrReplay(baseInput, [action])).resolves
      .toMatchObject({ disposition: "CREATED" });
    await expect(repository.transactOrReplay(baseInput, [action])).resolves
      .toMatchObject({ disposition: "REPLAYED" });
    expect(port.items.get("EFFECT#1\u0000METADATA")).toMatchObject({
      value: "created",
    });
    expect(port.items).toHaveLength(2);
  });

  it("rejects invalid expiration and non-JSON results before writing", async () => {
    const port = new MemoryDocumentPort();
    const repository = new IdempotencyRepository(
      port,
      "gym-adr-platform-local",
    );

    await expect(
      repository.recordOrReplay({
        ...baseInput,
        retention: { expiresAtEpochSeconds: 1, kind: "EPHEMERAL" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.recordOrReplay({
        ...baseInput,
        result: { invalid: undefined } as unknown as JsonValue,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(port.puts).toHaveLength(0);
  });
});
