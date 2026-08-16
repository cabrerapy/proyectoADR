import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { accessPatterns } from "./access-pattern-catalog.mjs";

test("the 25 approved access patterns map to implemented keyed operations", () => {
  assert.equal(accessPatterns.length, 25);
  assert.equal(new Set(accessPatterns.map(({ id }) => id)).size, 25);
  for (const pattern of accessPatterns) {
    assert.notEqual(pattern.operation, "Scan", pattern.id);
    assert.match(pattern.index, /^(PRIMARY|GSI[12]-)/u, pattern.id);
    const source = readFileSync(join("packages/data-access/src", pattern.source), "utf8");
    assert.match(source, new RegExp(`async\\s+${pattern.method}\\s*\\(`, "u"), `${pattern.id}: ${pattern.method}`);
  }
});
