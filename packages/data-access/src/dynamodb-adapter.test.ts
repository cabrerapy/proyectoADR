import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  GetCommand,
  type GetCommandOutput,
  QueryCommand,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import {
  AwsDynamoDbAdapter,
  type DynamoDbSdkClient,
} from "./dynamodb-adapter";

type AllowedCommand = BatchGetCommand | GetCommand | QueryCommand;

class FakeSdkClient implements DynamoDbSdkClient {
  readonly commands: AllowedCommand[] = [];
  destroyed = false;
  error?: unknown;

  destroy(): void {
    this.destroyed = true;
  }

  send(command: BatchGetCommand): Promise<BatchGetCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  async send(
    command: AllowedCommand,
  ): Promise<BatchGetCommandOutput | GetCommandOutput | QueryCommandOutput> {
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

    expect(client.commands[0]).toBeInstanceOf(GetCommand);
    expect(client.commands[1]).toBeInstanceOf(QueryCommand);
    expect(client.commands[2]).toBeInstanceOf(BatchGetCommand);
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
