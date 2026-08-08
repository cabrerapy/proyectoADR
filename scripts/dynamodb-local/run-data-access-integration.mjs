import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  startDynamoDbLocal,
  stopDynamoDbLocal,
} from "./runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath no está disponible para ejecutar la integración.");
}
let started = false;

try {
  await startDynamoDbLocal();
  started = true;
  const result = spawnSync(
    process.execPath,
    [npmCli, "run", "test:integration", "--workspace", "@gym-adr/data-access"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DYNAMODB_LOCAL_INTEGRATION: "1",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Las pruebas de integración finalizaron con código ${result.status ?? "desconocido"}.`,
    );
  }
} finally {
  if (started) {
    stopDynamoDbLocal();
  }
}
