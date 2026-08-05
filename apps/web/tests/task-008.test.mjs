import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(webRoot, "../..");
const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

test("TASK-008 pins a compatible OpenNext adapter", async () => {
  const webPackage = await readJson(path.join(webRoot, "package.json"));
  const adapterPackage = await readJson(
    path.join(
      repositoryRoot,
      "node_modules/@opennextjs/aws/package.json",
    ),
  );

  assert.equal(webPackage.dependencies.next, "16.2.12");
  assert.equal(webPackage.devDependencies["@opennextjs/aws"], "4.0.2");
  assert.equal(adapterPackage.version, "4.0.2");
  assert.equal(
    adapterPackage.peerDependencies.next,
    ">=15.5.18 <16 || >=16.2.6",
  );
  assert.match(webPackage.scripts["build:serverless"], /open-next build/);
});

test("TASK-008 uses standalone output without OpenNext persistence", async () => {
  const nextConfig = await readFile(
    path.join(webRoot, "next.config.ts"),
    "utf8",
  );
  const openNextConfig = await readFile(
    path.join(webRoot, "open-next.config.ts"),
    "utf8",
  );

  assert.match(nextConfig, /output: "standalone"/);
  assert.match(nextConfig, /poweredByHeader: false/);
  assert.match(openNextConfig, /disableIncrementalCache: true/);
  assert.match(openNextConfig, /disableTagCache: true/);
});
