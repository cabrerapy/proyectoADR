import {
  DynamoDbLocalError,
  smokeDynamoDbLocal,
  startDynamoDbLocal,
  stopDynamoDbLocal,
  testDynamoDbLocal,
} from "./runtime.mjs";

const commands = {
  down: stopDynamoDbLocal,
  smoke: smokeDynamoDbLocal,
  test: testDynamoDbLocal,
  up: startDynamoDbLocal,
};

const commandName = process.argv[2];
const command = commands[commandName];

if (!command) {
  process.stderr.write("Uso: cli.mjs <up|down|smoke|test>\n");
  process.exitCode = 2;
} else {
  try {
    await command();
    process.stdout.write(`DynamoDB Local: ${commandName} completado.\n`);
  } catch (error) {
    const message =
      error instanceof DynamoDbLocalError
        ? error.message
        : "Falló la operación de DynamoDB Local.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
