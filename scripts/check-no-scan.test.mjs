import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("production sources preserve the no-Scan invariant", () => {
  const result = spawnSync(process.execPath, ["scripts/check-no-scan.mjs"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No-Scan check passed/u);
});
