import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  GetCommand,
  type GetCommandOutput,
  PutCommand,
  type PutCommandOutput,
  QueryCommand,
  type QueryCommandOutput,
  TransactWriteCommand,
  type TransactWriteCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import {
  AwsDynamoDbAdapter,
  type DynamoDbSdkClient,
} from "./dynamodb-adapter";

type AllowedCommand =
  | BatchGetCommand
  | GetCommand
  | PutCommand
  | QueryCommand
  | TransactWriteCommand;

class FakeSdkClient implements DynamoDbSdkClient {
  readonly commands: AllowedCommand[] = [];
  destroyed = false;
  error?: unknown;

  destroy(): void {
    this.destroyed = true;
  }

  send(command: BatchGetCommand): Promise<BatchGetCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
  async send(
    command: AllowedCommand,
  ): Promise<
    | BatchGetCommandOutput
    | GetCommandOutput
    | PutCommandOutput
    | QueryCommandOutput
    | TransactWriteCommandOutput
  > {
    this.commands.push(command);
    if (this.error !== undefined) {
      throw this.error;
    }
    return { $metadata: { httpStatusCode: 200 } };
  }
}

const createAdapter = () => {
  const client = new FakeSdkClient();
  return { adapter: new AwsDynamoDbAdapter(client), client };
};

describe("AwsDynamoDbAdapter", () => {
  it("translates the allowed read operations to AWS SDK v3 commands", async () => {
    const { adapter, client } = createAdapter();

    await adapter.get({
      Key: { PK: "USER#u1", SK: "PROFILE" },
      TableName: "gym-adr-platform-local",
    });
    await adapter.query({
      ExpressionAttributeNames: { "#pk": "PK" },
      ExpressionAttributeValues: { ":pk": "USER#u1" },
      KeyConditionExpression: "#pk = :pk",
      TableName: "gym-adr-platform-local",
    });
    await adapter.batchGet({
      RequestItems: {
        "gym-adr-platform-local": {
          Keys: [{ PK: "USER#u1", SK: "PROFILE" }],
        },
      },
    });
    await adapter.put({
      Item: { PK: "IDEMPOTENCY#BOOKING#u1", SK: "REQUEST#request1" },
      TableName: "gym-adr-platform-local",
    });
    await adapter.transactWrite({
      TransactItems: [{
        Put: {
          Item: { PK: "EFFECT#1", SK: "METADATA" },
          TableName: "gym-adr-platform-local",
        },
      }],
    });

    expect(client.commands[0]).toBeInstanceOf(GetCommand);
    expect(client.commands[1]).toBeInstanceOf(QueryCommand);
    expect(client.commands[2]).toBeInstanceOf(BatchGetCommand);
    expect(client.commands[3]).toBeInstanceOf(PutCommand);
    expect(client.commands[4]).toBeInstanceOf(TransactWriteCommand);
    adapter.destroy();
    expect(client.destroyed).toBe(true);
  });

  it("sanitizes SDK errors at the adapter boundary", async () => {
    const { adapter, client } = createAdapter();
    client.error = Object.assign(new Error("raw service details"), {
      name: "ResourceNotFoundException",
    });

    const operation = adapter.get({
      Key: { PK: "USER#u1", SK: "PROFILE" },
      TableName: "gym-adr-platform-local",
    });

    await expect(operation).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: "El recurso de persistencia no está disponible.",
    });
    adapter.destroy();
  });
});
