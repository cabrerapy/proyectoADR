import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("TASK-003 configures App Router, strict TypeScript, and Tailwind", async () => {
  const [packageJsonSource, tsconfigSource, globalStyles, pageSource] =
    await Promise.all([
      readProjectFile("package.json"),
      readProjectFile("tsconfig.json"),
      readProjectFile("src/app/globals.css"),
      readProjectFile("src/app/page.tsx"),
    ]);

  const packageJson = JSON.parse(packageJsonSource);
  const tsconfig = JSON.parse(tsconfigSource);

  assert.equal(packageJson.dependencies.next, "16.3.0");
  assert.equal(packageJson.devDependencies.tailwindcss, "^4");
  assert.equal(tsconfig.extends, "../../tsconfig.base.json");
  assert.notEqual(tsconfig.compilerOptions.allowJs, true);
  assert.match(globalStyles, /@import\s+["']tailwindcss["']/u);
  assert.match(pageSource, /export\s+default\s+function\s+Home/u);
});
