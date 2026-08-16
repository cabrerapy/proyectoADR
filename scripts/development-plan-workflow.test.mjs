import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/development-plan.yml", "utf8");

test("development planning uses OIDC, environment approval and never deploys", () => {
  for (const required of [
    "workflow_dispatch:",
    "environment: development",
    "id-token: write",
    "contents: read",
    "aws-actions/configure-aws-credentials@v4",
    "vars.AWS_DEVELOPMENT_PLAN_ROLE_ARN",
    "npm test --workspace @gym-adr/infrastructure",
    "npm run synth:development --workspace @gym-adr/infrastructure",
    "npx cdk diff -c environment=development --fail",
  ]) assert.ok(workflow.includes(required), `Falta en el plan: ${required}`);
  assert.doesNotMatch(workflow, /cdk\s+(deploy|bootstrap)/iu);
  assert.doesNotMatch(workflow, /aws-access-key|secret-access-key/iu);
  assert.doesNotMatch(workflow, /push:\s|pull_request:/u);
});
