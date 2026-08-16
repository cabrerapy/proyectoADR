import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("CI validates quality, DynamoDB, web, E2E and IaC without deployment", () => {
  for (const required of [
    "pull_request:",
    "permissions:\n  contents: read",
    "npm ci",
    "npm run check",
    "npm audit --omit=dev --audit-level=high",
    "npm run test:data-access:integration",
    "npm run build",
    "npm run synth:development --workspace @gym-adr/infrastructure",
    "npm run test:e2e --workspace @gym-adr/web",
  ]) assert.ok(workflow.includes(required), `Falta en CI: ${required}`);
  assert.doesNotMatch(workflow, /cdk\s+(deploy|bootstrap)/iu);
  assert.doesNotMatch(workflow, /aws-access-key|secret-access-key/iu);
});
