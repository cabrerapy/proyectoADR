import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createDynamoDbLocalConfig } from "./config.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const composeFile = path.join(
  repositoryRoot,
  "compose.dynamodb-local.yml",
);
const composeProject = "gym-adr-platform-local";

export class DynamoDbLocalError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "DynamoDbLocalError";
  }
}

const runDockerCompose = (args) => {
  const result = spawnSync(
    "docker",
    ["compose", "--project-name", composeProject, "--file", composeFile, ...args],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.error?.code === "ENOENT") {
    throw new DynamoDbLocalError(
      "Docker CLI no está disponible. Instala Docker Desktop o un motor compatible y vuelve a intentarlo.",
    );
  }
  if (result.error) {
    throw new DynamoDbLocalError("No fue posible ejecutar Docker Compose.", {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new DynamoDbLocalError(
      `Docker Compose finalizó con código ${result.status ?? "desconocido"}.`,
    );
  }
};

const waitForTableStatus = async (client, tableName, expectedStatus) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await client.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
      if (response.Table?.TableStatus === expectedStatus) {
        return;
      }
    } catch (error) {
      if (expectedStatus === "DELETED" && error?.name === "ResourceNotFoundException") {
        return;
      }
      if (expectedStatus !== "DELETED") {
        throw error;
      }
    }

    await delay(100);
  }

  throw new DynamoDbLocalError(
    `La tabla efímera no alcanzó el estado ${expectedStatus}.`,
  );
};

export const waitForDynamoDbLocal = async (client) => {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await client.send(new ListTablesCommand({ Limit: 1 }));
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new DynamoDbLocalError(
    "DynamoDB Local no respondió dentro de 15 segundos.",
    { cause: lastError },
  );
};

export const runTransactionSmoke = async (client) => {
  const runId = `${Date.now()}-${process.pid}`;
  const tableName = `gym-adr-platform-local-smoke-${runId}`;
  const partitionKey = `SMOKE#${runId}`;
  let tableCreated = false;

  try {
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
    tableCreated = true;
    await waitForTableStatus(client, tableName, "ACTIVE");

    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: ["ONE", "TWO"].map((sortKey, index) => ({
          Put: {
            ConditionExpression:
              "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
            ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
            Item: {
              PK: { S: partitionKey },
              SK: { S: sortKey },
              value: { N: String(index + 1) },
            },
            TableName: tableName,
          },
        })),
      }),
    );

    const items = await Promise.all(
      ["ONE", "TWO"].map((sortKey) =>
        client.send(
          new GetItemCommand({
            ConsistentRead: true,
            Key: { PK: { S: partitionKey }, SK: { S: sortKey } },
            TableName: tableName,
          }),
        ),
      ),
    );
    if (items.some(({ Item }) => Item === undefined)) {
      throw new DynamoDbLocalError(
        "La transacción local no escribió todos los elementos.",
      );
    }
  } finally {
    if (tableCreated) {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      await waitForTableStatus(client, tableName, "DELETED");
    }
  }
};

export const startDynamoDbLocal = async () => {
  runDockerCompose(["up", "--detach", "--remove-orphans"]);
  const client = new DynamoDBClient(createDynamoDbLocalConfig());
  try {
    await waitForDynamoDbLocal(client);
  } catch (error) {
    try {
      stopDynamoDbLocal();
    } catch (cleanupError) {
      throw new DynamoDbLocalError(
        "DynamoDB Local no inició y Docker Compose tampoco pudo limpiarse.",
        { cause: new AggregateError([error, cleanupError]) },
      );
    }
    throw error;
  } finally {
    client.destroy();
  }
};

export const stopDynamoDbLocal = () => {
  runDockerCompose(["down", "--volumes", "--remove-orphans"]);
};

export const smokeDynamoDbLocal = async () => {
  const client = new DynamoDBClient(createDynamoDbLocalConfig());
  try {
    await waitForDynamoDbLocal(client);
    await runTransactionSmoke(client);
  } finally {
    client.destroy();
  }
};

export const testDynamoDbLocal = async () => {
  let started = false;
  try {
    await startDynamoDbLocal();
    started = true;
    await smokeDynamoDbLocal();
  } finally {
    if (started) {
      stopDynamoDbLocal();
    }
  }
};
