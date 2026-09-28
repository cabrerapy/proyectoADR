import {
  LOCAL_FIXTURE_USERS,
  prepareLocalEnvironment,
  shutdownLocalEnvironment,
} from "./runtime.mjs";

const command = process.argv[2] ?? "dev";

if (!new Set(["dev", "reset"]).has(command)) {
  throw new Error("Uso: node scripts/local-environment/cli.mjs <dev|reset>");
}

if (command === "reset") {
  const { fixtures, web } = await prepareLocalEnvironment({ port: 3101, reset: true });
  await shutdownLocalEnvironment(web, false);
  console.log(`Entorno local reiniciado y sembrado en ${fixtures.tableName}.`);
  console.log("DynamoDB Local permanece activo; ejecuta npm run dev:local para abrir la aplicación.");
  process.exit(0);
}

const { fixtures, web } = await prepareLocalEnvironment({ port: 3000 });
console.log(`Gym ADR local listo en ${web.url}`);
console.log(`${web.url}/local-login`);
console.log(`Perfiles fake: ${LOCAL_FIXTURE_USERS.join(", ")}`);
console.log(`Clase reservable: ${fixtures.classId} (${fixtures.classDate})`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await shutdownLocalEnvironment(web);
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise((resolve) => web.child.once("exit", resolve));
if (!stopping) {
  stopping = true;
  await shutdownLocalEnvironment(web);
  process.exit(web.child.exitCode ?? 1);
}
