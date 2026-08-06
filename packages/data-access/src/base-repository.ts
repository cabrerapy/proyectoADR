import type { QueryCommandInput } from "@aws-sdk/lib-dynamodb";

import type {
  DynamoDbDocumentPort,
  DynamoDbItem,
  DynamoDbKey,
} from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
  mapDynamoDbError,
} from "./dynamodb-errors";
import type { PrimaryKey } from "./model-types";

type ExpressionValue = NonNullable<
  QueryCommandInput["ExpressionAttributeValues"]
>[string];

export const APPROVED_INDEXES = [
  "GSI1-Operational",
  "GSI2-Relationships",
] as const;

export type ApprovedIndex = (typeof APPROVED_INDEXES)[number];

type SortKeyCondition =
  | { readonly operation: "BEGINS_WITH"; readonly value: string }
  | {
      readonly from: string;
      readonly operation: "BETWEEN";
      readonly to: string;
    }
  | { readonly operation: "EQUALS"; readonly value: string };

export interface QueryPageInput {
  readonly consistentRead?: boolean;
  readonly cursor?: DynamoDbKey;
  readonly indexName?: ApprovedIndex;
  readonly limit?: number;
  readonly partitionValue: string;
  readonly sortKey?: SortKeyCondition;
}

export interface QueryPage {
  readonly items: readonly DynamoDbItem[];
  readonly nextCursor?: DynamoDbKey;
}

export interface BaseRepositoryOptions {
  readonly batchGetAttempts?: number;
  readonly retryDelay?: (attempt: number) => Promise<void>;
  readonly tableName: string;
}

const delay = async (attempt: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
};

const assertTableName = (tableName: string): string => {
  if (!/^[A-Za-z0-9_.-]{3,255}$/u.test(tableName)) {
    throw invalidDynamoDbInput("El nombre de la tabla DynamoDB no es válido.");
  }
  return tableName;
};

const assertPrimaryKey = (key: PrimaryKey): void => {
  if (
    typeof key.PK !== "string" ||
    key.PK === "" ||
    typeof key.SK !== "string" ||
    key.SK === ""
  ) {
    throw invalidDynamoDbInput("PK y SK son obligatorias.");
  }
};

const indexAttributes = (
  indexName: ApprovedIndex | undefined,
): { readonly partition: string; readonly sort: string } => {
  switch (indexName) {
    case "GSI1-Operational":
      return { partition: "GSI1PK", sort: "GSI1SK" };
    case "GSI2-Relationships":
      return { partition: "GSI2PK", sort: "GSI2SK" };
    default:
      return { partition: "PK", sort: "SK" };
  }
};

const buildSortExpression = (
  condition: SortKeyCondition | undefined,
): {
  readonly expression: string;
  readonly values: Record<string, ExpressionValue>;
} => {
  if (condition === undefined) {
    return { expression: "", values: {} };
  }
  switch (condition.operation) {
    case "BEGINS_WITH":
      if (condition.value === "") {
        throw invalidDynamoDbInput("El prefijo de orden es obligatorio.");
      }
      return {
        expression: " AND begins_with(#sk, :sortValue)",
        values: { ":sortValue": condition.value },
      };
    case "BETWEEN":
      if (
        condition.from === "" ||
        condition.to === "" ||
        condition.from > condition.to
      ) {
        throw invalidDynamoDbInput("El rango de orden no es válido.");
      }
      return {
        expression: " AND #sk BETWEEN :sortFrom AND :sortTo",
        values: { ":sortFrom": condition.from, ":sortTo": condition.to },
      };
    case "EQUALS":
      if (condition.value === "") {
        throw invalidDynamoDbInput("El valor de orden es obligatorio.");
      }
      return {
        expression: " AND #sk = :sortValue",
        values: { ":sortValue": condition.value },
      };
  }
};

export class BaseDynamoDbRepository {
  private readonly batchGetAttempts: number;
  private readonly retryDelay: (attempt: number) => Promise<void>;
  private readonly tableName: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    options: BaseRepositoryOptions,
  ) {
    this.tableName = assertTableName(options.tableName);
    this.batchGetAttempts = options.batchGetAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? delay;
    if (
      !Number.isSafeInteger(this.batchGetAttempts) ||
      this.batchGetAttempts < 1 ||
      this.batchGetAttempts > 10
    ) {
      throw invalidDynamoDbInput(
        "Los intentos de BatchGet deben estar entre 1 y 10.",
      );
    }
  }

  async batchGet(
    keys: readonly PrimaryKey[],
    consistentRead = false,
  ): Promise<readonly DynamoDbItem[]> {
    if (keys.length < 1 || keys.length > 100) {
      throw invalidDynamoDbInput(
        "BatchGet requiere entre 1 y 100 claves.",
      );
    }
    keys.forEach(assertPrimaryKey);
    const uniqueKeys = new Set(keys.map(({ PK, SK }) => `${PK}\u0000${SK}`));
    if (uniqueKeys.size !== keys.length) {
      throw invalidDynamoDbInput("BatchGet no admite claves duplicadas.");
    }

    const items: DynamoDbItem[] = [];
    let pendingKeys: readonly DynamoDbKey[] = keys;

    for (let attempt = 0; attempt < this.batchGetAttempts; attempt += 1) {
      try {
        const output = await this.document.batchGet({
          RequestItems: {
            [this.tableName]: {
              ConsistentRead: consistentRead,
              Keys: [...pendingKeys],
            },
          },
        });
        const received = output.Responses?.[this.tableName] ?? [];
        items.push(...received);
        pendingKeys =
          output.UnprocessedKeys?.[this.tableName]?.Keys ?? [];
      } catch (error) {
        throw mapDynamoDbError(error);
      }

      if (pendingKeys.length === 0) {
        return items;
      }
      if (attempt + 1 < this.batchGetAttempts) {
        await this.retryDelay(attempt);
      }
    }

    throw new DynamoDbRepositoryError(
      "UNPROCESSED_KEYS",
      "DynamoDB no procesó todas las claves del lote.",
      { retryable: true },
    );
  }

  destroy(): void {
    this.document.destroy();
  }

  async get(
    key: PrimaryKey,
    consistentRead = false,
  ): Promise<DynamoDbItem | undefined> {
    assertPrimaryKey(key);
    try {
      const output = await this.document.get({
        ConsistentRead: consistentRead,
        Key: key,
        TableName: this.tableName,
      });
      return output.Item;
    } catch (error) {
      throw mapDynamoDbError(error);
    }
  }

  async queryPage(
    input: QueryPageInput,
  ): Promise<QueryPage> {
    const limit = input.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw invalidDynamoDbInput("El límite de Query debe estar entre 1 y 100.");
    }
    if (input.partitionValue === "") {
      throw invalidDynamoDbInput("El valor de partición es obligatorio.");
    }
    if (input.indexName !== undefined && input.consistentRead === true) {
      throw invalidDynamoDbInput(
        "Los índices secundarios globales sólo admiten consistencia eventual.",
      );
    }

    const attributes = indexAttributes(input.indexName);
    const sort = buildSortExpression(input.sortKey);
    try {
      const output = await this.document.query({
        ConsistentRead: input.indexName === undefined
          ? input.consistentRead
          : false,
        ExclusiveStartKey: input.cursor,
        ExpressionAttributeNames: {
          "#pk": attributes.partition,
          ...(input.sortKey === undefined ? {} : { "#sk": attributes.sort }),
        },
        ExpressionAttributeValues: {
          ":partitionValue": input.partitionValue,
          ...sort.values,
        },
        IndexName: input.indexName,
        KeyConditionExpression: `#pk = :partitionValue${sort.expression}`,
        Limit: limit,
        TableName: this.tableName,
      });

      return {
        items: output.Items ?? [],
        ...(output.LastEvaluatedKey === undefined
          ? {}
          : { nextCursor: output.LastEvaluatedKey }),
      };
    } catch (error) {
      throw mapDynamoDbError(error);
    }
  }
}
