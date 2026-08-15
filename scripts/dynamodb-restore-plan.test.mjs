import assert from "node:assert/strict";
import test from "node:test";

import { buildRestorePlan } from "./dynamodb-restore-plan.mjs";

test("builds a non-destructive restore plan targeting a new table", () => {
  const plan = buildRestorePlan({ sourceTable: "gym-adr-platform-production", targetTable: "gym-adr-platform-production-restore-20260815T120000Z", restoreAt: "2026-08-15T12:00:00Z" });
  assert.equal(plan.destructive, false);
  assert.notEqual(plan.sourceTable, plan.targetTable);
  assert.ok(plan.restore.includes("restore-table-to-point-in-time"));
  assert.deepEqual(plan.requiredChecks, ["ACTIVE", "PK_SK", "GSI1_OPERATIONAL", "GSI2_RELATIONSHIPS", "SSE_KMS", "SAMPLE_STRONG_READS"]);
});

test("rejects overwrite and unbounded targets", () => {
  assert.throws(() => buildRestorePlan({ sourceTable: "gym-adr-platform-production", targetTable: "gym-adr-platform-production", restoreAt: "2026-08-15T12:00:00Z" }));
  assert.throws(() => buildRestorePlan({ sourceTable: "other", targetTable: "gym-adr-platform-production-restore-20260815T120000Z", restoreAt: "now" }));
});
