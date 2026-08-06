import {
  BatchGetCommand,
  type BatchGetCommandInput,
  type BatchGetCommandOutput,
  GetCommand,
  type GetCommandInput,
  type GetCommandOutput,
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";

import {
  createDynamoDbDocumentClient,
  type DynamoDbConnectionConfig,
} from "./dynamodb-config";
import { mapDynamoDbError } from "./dynamodb-errors";

export type DynamoDbItem = NonNullable<GetCommandOutput["Item"]>;
export type DynamoDbKey = NonNullable<
  QueryCommandOutput["LastEvaluatedKey"]
>;

export interface DynamoDbDocumentPort {
  readonly batchGet: (
    input: BatchGetCommandInput,
  ) => Promise<BatchGetCommandOutput>;
  readonly destroy: () => void;
  readonly get: (input: GetCommandInput) => Promise<GetCommandOutput>;
  readonly query: (input: QueryCommandInput) => Promise<QueryCommandOutput>;
}

export interface DynamoDbSdkClient {
  readonly destroy: () => void;
  send(command: BatchGetCommand): Promise<BatchGetCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

export class AwsDynamoDbAdapter implements DynamoDbDocumentPort {
  constructor(private readonly client: DynamoDbSdkClient) {}

  async batchGet(input: BatchGetCommandInput): Promise<BatchGetCommandOutput> {
    try {
      return await this.client.send(new BatchGetCommand(input));
    } catch (error) {
      throw mapDynamoDbError(error);
    }
  }

  destroy(): void {
    this.client.destroy();
  }

  async get(input: GetCommandInput): Promise<GetCommandOutput> {
    try {
      return await this.client.send(new GetCommand(input));
    } catch (error) {
      throw mapDynamoDbError(error);
    }
  }

  async query(input: QueryCommandInput): Promise<QueryCommandOutput> {
    try {
      return await this.client.send(new QueryCommand(input));
    } catch (error) {
      throw mapDynamoDbError(error);
    }
  }
}

export const createDynamoDbAdapter = (
  config: DynamoDbConnectionConfig,
): AwsDynamoDbAdapter =>
  new AwsDynamoDbAdapter(createDynamoDbDocumentClient(config));
