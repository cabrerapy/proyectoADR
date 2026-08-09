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

  assert.equal(webPackage.dependencies.next, "16.3.0");
  assert.equal(webPackage.devDependencies["@opennextjs/aws"], "4.0.2");
  assert.equal(adapterPackage.version, "4.0.2");
  assert.equal(
    adapterPackage.peerDependencies.next,
    ">=15.5.18 <16 || >=16.2.6",
  );
  assert.equal(
    webPackage.scripts.build,
    "next build --webpack",
  );
  assert.equal(
    webPackage.scripts["build:serverless"],
    "node scripts/build-serverless.mjs",
  );
  assert.equal(
    webPackage.scripts["build:serverless:direct"],
    "open-next build",
  );
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
  assert.match(nextConfig, /OPEN_NEXT_MONOREPO_ROOT/);
  assert.match(nextConfig, /transpilePackages/);
  assert.match(nextConfig, /@gym-adr\/data-access/);
  assert.match(openNextConfig, /build-next-for-opennext\.mjs/);
  assert.match(nextConfig, /poweredByHeader: false/);
  assert.match(openNextConfig, /disableIncrementalCache: true/);
  assert.match(openNextConfig, /disableTagCache: true/);
});

test("TASK-008 confines the Windows OpenNext build to the repository", async () => {
  const buildScript = await readFile(
    path.join(webRoot, "scripts/build-serverless.mjs"),
    "utf8",
  );

  assert.match(buildScript, /process\.platform !== "win32"/);
  assert.match(buildScript, /process\.env\.npm_execpath/);
  assert.match(buildScript, /spawnSync\(\s*process\.execPath/);
  assert.match(buildScript, /execFileSync\("subst\.exe"/);
  assert.match(buildScript, /path\.relative\(repositoryRoot, webRoot\)/);
  assert.match(buildScript, /OPEN_NEXT_MONOREPO_ROOT/);
  assert.match(buildScript, /OPEN_NEXT_REAL_MONOREPO_ROOT/);
  assert.match(buildScript, /--preserve-symlinks/);
  const tracingScript = await readFile(
    path.join(webRoot, "scripts/build-next-for-opennext.mjs"),
    "utf8",
  );
  assert.match(tracingScript, /\.nft\.json/);
  assert.match(tracingScript, /path\.relative/);
  assert.match(tracingScript, /OPEN_NEXT_MONOREPO_ROOT/);
  assert.match(buildScript, /sharp@0\.32\.6/);
  assert.match(buildScript, /npm_config_platform: "linux"/);
  assert.match(buildScript, /npm_config_arch: "arm64"/);
  assert.match(buildScript, /linux-arm64v8/);
  assert.match(buildScript, /SHARP_IGNORE_GLOBAL_LIBVIPS/);
  assert.match(buildScript, /--package-lock=false/);
  assert.match(buildScript, /attempt <= 3/);
  assert.match(buildScript, /tras tres intentos/);
  assert.match(buildScript, /rmSync\(installRoot/);
  assert.match(buildScript, /finally \{/);
  assert.match(buildScript, /\[drive, "\/D"\]/);
});
