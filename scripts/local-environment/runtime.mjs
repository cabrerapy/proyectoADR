import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { createDynamoDbLocalConfig } from "../dynamodb-local/config.mjs";
import { startDynamoDbLocal, stopDynamoDbLocal, waitForDynamoDbLocal } from "../dynamodb-local/runtime.mjs";

export const LOCAL_TABLE_NAME = "gym-adr-platform-local";
export const LOCAL_FIXTURE_USERS = ["student", "staff", "admin", "pending", "suspended", "inactive"];

const webRoot = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const nextCli = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
const localSearchKey = "local-only-not-a-secret-search-key-2026-fixture";

const waitForTable = async (client, tableName, expected) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
      if (result.Table?.TableStatus === expected) return;
    } catch (error) {
      if (expected === "DELETED" && error?.name === "ResourceNotFoundException") return;
      if (expected !== "DELETED") throw error;
    }
    await delay(100);
  }
  throw new Error(`La tabla local no alcanzó el estado ${expected}.`);
};

export const ensureLocalTable = async ({ reset = false } = {}) => {
  const client = new DynamoDBClient(createDynamoDbLocalConfig());
  try {
    await waitForDynamoDbLocal(client);
    let exists = true;
    try {
      await client.send(new DescribeTableCommand({ TableName: LOCAL_TABLE_NAME }));
    } catch (error) {
      if (error?.name !== "ResourceNotFoundException") throw error;
      exists = false;
    }
    if (reset && exists) {
      await client.send(new DeleteTableCommand({ TableName: LOCAL_TABLE_NAME }));
      await waitForTable(client, LOCAL_TABLE_NAME, "DELETED");
      exists = false;
    }
    if (!exists) {
      await client.send(new CreateTableCommand({
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
          { AttributeName: "GSI2PK", AttributeType: "S" },
          { AttributeName: "GSI2SK", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1-Operational",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
          {
            IndexName: "GSI2-Relationships",
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        TableName: LOCAL_TABLE_NAME,
      }));
      await waitForTable(client, LOCAL_TABLE_NAME, "ACTIVE");
    }
  } finally {
    client.destroy();
  }
};

const localEnvironment = (port, bootstrapToken) => ({
  ...process.env,
  APP_BASE_URL: `http://localhost:${port}`,
  APP_ENVIRONMENT: "local",
  AWS_REGION: "us-east-1",
  COGNITO_CLIENT_ID: "local-client",
  COGNITO_HOSTED_UI_BASE_URL: "https://gym-local.auth.us-east-1.amazoncognito.com",
  COGNITO_REDIRECT_URI: "http://localhost:3000/api/auth/callback/cognito",
  COGNITO_USER_POOL_ID: "us-east-1_Local",
  DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
  DYNAMODB_TABLE_NAME: LOCAL_TABLE_NAME,
  LOCAL_AUTH_ENABLED: "1",
  LOCAL_BOOTSTRAP_TOKEN: bootstrapToken,
  SEARCH_TOKEN_HMAC_KEY: localSearchKey,
});

export const startLocalWeb = (port) => {
  const bootstrapToken = randomBytes(24).toString("base64url");
  const child = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: webRoot,
    env: localEnvironment(port, bootstrapToken),
    stdio: "inherit",
    windowsHide: true,
  });
  return { bootstrapToken, child, url: `http://localhost:${port}` };
};

export const waitForWeb = async ({ child, url }) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js finalizó antes de iniciar (${child.exitCode}).`);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // El servidor todavía está iniciando.
    }
    await delay(250);
  }
  throw new Error("Next.js no respondió dentro de 40 segundos.");
};

export const bootstrapFixtures = async ({ bootstrapToken, url }) => {
  const response = await fetch(`${url}/api/local/bootstrap`, {
    headers: { "x-local-bootstrap-token": bootstrapToken },
    method: "POST",
  });
  if (!response.ok) throw new Error(`El bootstrap local falló (${response.status}): ${await response.text()}`);
  return response.json();
};

export const stopWeb = async (child) => {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000),
  ]);
};

export const prepareLocalEnvironment = async ({ port = 3000, reset = false } = {}) => {
  await startDynamoDbLocal();
  await ensureLocalTable({ reset });
  const web = startLocalWeb(port);
  try {
    await waitForWeb(web);
    const fixtures = await bootstrapFixtures(web);
    return { fixtures, web };
  } catch (error) {
    await stopWeb(web.child);
    stopDynamoDbLocal();
    throw error;
  }
};

export const shutdownLocalEnvironment = async (web, stopDatabase = true) => {
  await stopWeb(web.child);
  if (stopDatabase) stopDynamoDbLocal();
};
