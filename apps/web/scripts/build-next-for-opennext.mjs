import { spawnSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");
const nextCli = path.join(
  repositoryRoot,
  "node_modules/next/dist/bin/next",
);

const result = spawnSync(
  process.execPath,
  [nextCli, "build", "--webpack"],
  { cwd: webRoot, env: process.env, stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const tracingRoot = process.env.OPEN_NEXT_MONOREPO_ROOT;
if (process.platform !== "win32" || tracingRoot === undefined) process.exit(0);

const nextRoot = path.join(webRoot, ".next");
const manifests = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    if (statSync(filePath).isDirectory()) visit(filePath);
    else if (entry.endsWith(".nft.json")) manifests.push(filePath);
  }
};
visit(nextRoot);

const realRoot = (
  process.env.OPEN_NEXT_REAL_MONOREPO_ROOT ?? repositoryRoot
).replaceAll("\\", "/");
for (const manifestPath of manifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files)) {
    throw new Error(`Manifest de tracing inválido: ${manifestPath}`);
  }
  manifest.files = manifest.files.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Entrada de tracing inválida: ${manifestPath}`);
    }
    const normalized = entry.replaceAll("\\", "/");
    const rootOffset = normalized.toLowerCase().indexOf(realRoot.toLowerCase());
    if (rootOffset < 0) return entry;
    const suffix = normalized.slice(rootOffset + realRoot.length + 1);
    return path.relative(
      path.dirname(manifestPath),
      path.join(tracingRoot, suffix),
    ).replaceAll("\\", "/");
  });
  writeFileSync(manifestPath, JSON.stringify(manifest));
}
