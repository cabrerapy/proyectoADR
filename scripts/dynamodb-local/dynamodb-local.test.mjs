import assert from "node:assert/strict";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDynamoDbLocalConfig,
  parseDynamoDbLocalPort,
} from "./config.mjs";
import { runTransactionSmoke } from "./runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("validates the local-only endpoint configuration", () => {
  assert.equal(parseDynamoDbLocalPort(undefined), 8000);
  assert.equal(parseDynamoDbLocalPort("18000"), 18_000);
  assert.throws(() => parseDynamoDbLocalPort("80"), /entre 1024 y 65535/);
  assert.throws(() => parseDynamoDbLocalPort("invalid"), /número entero/);

  assert.deepEqual(createDynamoDbLocalConfig({ DYNAMODB_LOCAL_PORT: "18000" }), {
    credentials: {
      accessKeyId: "localplaceholder",
      secretAccessKey: "localplaceholder",
    },
    endpoint: "http://127.0.0.1:18000",
    region: "local",
  });
});

test("pins an isolated in-memory DynamoDB Local container", async () => {
  const compose = await readFile(
    path.join(repositoryRoot, "compose.dynamodb-local.yml"),
    "utf8",
  );

  assert.match(compose, /amazon\/dynamodb-local:2\.6\.1/);
  assert.match(compose, /-inMemory -sharedDb/);
  assert.match(compose, /127\.0\.0\.1:/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
});

test("uses an atomic smoke transaction and guaranteed table cleanup", async () => {
  const runtime = await readFile(
    path.join(repositoryRoot, "scripts/dynamodb-local/runtime.mjs"),
    "utf8",
  );

  assert.match(runtime, /TransactWriteItemsCommand/);
  assert.match(runtime, /ConditionExpression/);
  assert.match(runtime, /ConsistentRead: true/);
  assert.match(runtime, /DeleteTableCommand/);
  assert.match(runtime, /DynamoDB Local no inició y Docker Compose tampoco pudo limpiarse/);
  assert.match(runtime, /stopDynamoDbLocal\(\)/);
  assert.match(runtime, /finally \{/);
  assert.doesNotMatch(runtime, /ScanCommand/);
});

const createFakeClient = ({ transactionError } = {}) => {
  const commands = [];
  let deleted = false;

  return {
    commands,
    async send(command) {
      commands.push(command);

      if (command instanceof DescribeTableCommand) {
        if (deleted) {
          const error = new Error("missing");
          error.name = "ResourceNotFoundException";
          throw error;
        }
        return { Table: { TableStatus: "ACTIVE" } };
      }
      if (command instanceof TransactWriteItemsCommand && transactionError) {
        throw transactionError;
      }
      if (command instanceof GetItemCommand) {
        return { Item: { PK: { S: "present" } } };
      }
      if (command instanceof DeleteTableCommand) {
        deleted = true;
      }

      return {};
    },
  };
};

test("executes two conditional puts and strongly verifies the result", async () => {
  const client = createFakeClient();

  await runTransactionSmoke(client);

  assert.ok(client.commands[0] instanceof CreateTableCommand);
  const transaction = client.commands.find(
    (command) => command instanceof TransactWriteItemsCommand,
  );
  assert.equal(transaction.input.TransactItems.length, 2);
  assert.ok(
    transaction.input.TransactItems.every(
      ({ Put }) =>
        Put?.ConditionExpression ===
        "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
    ),
  );
  const reads = client.commands.filter(
    (command) => command instanceof GetItemCommand,
  );
  assert.equal(reads.length, 2);
  assert.ok(reads.every(({ input }) => input.ConsistentRead === true));
  assert.ok(
    client.commands.some((command) => command instanceof DeleteTableCommand),
  );
});

test("deletes the ephemeral table when the transaction fails", async () => {
  const transactionError = new Error("transaction failed");
  const client = createFakeClient({ transactionError });

  await assert.rejects(
    runTransactionSmoke(client),
    (error) => error === transactionError,
  );
  assert.ok(
    client.commands.some((command) => command instanceof DeleteTableCommand),
  );
});
