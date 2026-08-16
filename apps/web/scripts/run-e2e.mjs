import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const nextCli = fileURLToPath(
  new URL("../../../node_modules/next/dist/bin/next", import.meta.url),
);
const playwrightCli = fileURLToPath(
  new URL("../../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const serverUrl = "http://127.0.0.1:3100";

const run = (command, args) =>
  spawn(command, args, {
    cwd: webRoot,
    env: {
      ...process.env,
      APP_BASE_URL: "http://localhost:3100",
      APP_ENVIRONMENT: "local",
      AWS_REGION: "us-east-1",
      COGNITO_CLIENT_ID: "local-client",
      COGNITO_HOSTED_UI_BASE_URL: "https://gym-local.auth.us-east-1.amazoncognito.com",
      COGNITO_REDIRECT_URI: "http://localhost:3000/api/auth/callback/cognito",
      COGNITO_USER_POOL_ID: "us-east-1_Local",
      DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
      DYNAMODB_TABLE_NAME: "gym-adr-platform-local",
      SEARCH_TOKEN_HMAC_KEY: randomBytes(32).toString("base64url"),
    },
    stdio: "inherit",
    windowsHide: true,
  });

const waitForServer = async (server) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before readiness (${server.exitCode}).`);
    }

    try {
      const response = await fetch(serverUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await delay(250);
  }

  throw new Error("Next.js did not become ready within 30 seconds.");
};

const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

const stopServer = async (server) => {
  if (server.exitCode !== null || server.pid === undefined) {
    return;
  }

  server.kill();
  await Promise.race([waitForExit(server), delay(2_000)]);
};

const server = run(process.execPath, [
  nextCli,
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3100",
]);

let testExitCode = 1;

try {
  await waitForServer(server);
  const requestedTests = process.argv.slice(2);
  const playwright = run(process.execPath, [playwrightCli, "test", ...requestedTests]);
  testExitCode = await waitForExit(playwright);
} finally {
  await stopServer(server);
}

process.exit(testExitCode);
