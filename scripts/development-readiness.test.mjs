import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const environment = readFileSync("infrastructure/src/config/environment.ts", "utf8");
const table = readFileSync("infrastructure/src/database/dynamodb-table.ts", "utf8");
const auth = readFileSync("infrastructure/src/auth/auth-environment.ts", "utf8");
const delivery = readFileSync("infrastructure/src/notifications/notification-delivery.ts", "utf8");
const workflow = readFileSync(".github/workflows/development-plan.yml", "utf8");
const runbook = readFileSync("docs/runbooks/development-readiness.md", "utf8");

test("development readiness keeps exact local guardrails and manual deployment gates", () => {
  for (const expected of [
    'stackName: "gym-adr-platform-development"',
    "dynamoDbMaxReadRequestUnits: 500",
    "dynamoDbMaxWriteRequestUnits: 500",
    "monthlyBudgetUsd: 25",
  ]) assert.ok(environment.includes(expected), `Falta guardrail: ${expected}`);

  assert.match(table, /BillingMode\.PAY_PER_REQUEST/u);
  assert.match(table, /GSI1-Operational/u);
  assert.match(table, /GSI2-Relationships/u);
  assert.match(auth, /gym-adr-platform\/\$\{environment\.name\}\/cognito/u);
  assert.match(delivery, /Dirección SES verificada/u);
  assert.match(workflow, /environment: development/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /vars\.AWS_REGION/u);
  assert.doesNotMatch(workflow, /cdk\s+(deploy|bootstrap)/iu);

  for (const gate of ["cuenta AWS", "región", "OIDC", "Google/Facebook", "SES", "cdk diff", "rollback"]) {
    assert.ok(runbook.includes(gate), `Falta puerta manual: ${gate}`);
  }
  assert.match(runbook, /NO AUTORIZADO PARA DESPLEGAR/u);
});
