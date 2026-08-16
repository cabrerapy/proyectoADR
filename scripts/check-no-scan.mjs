import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = ["apps", "packages", "infrastructure"];
const allowedGuard = "packages\\data-access\\src\\dynamodb-adapter.ts";
const ignoredDirectories = new Set([".next", ".open-next", "cdk.out", "coverage", "dist", "node_modules"]);
const violations = [];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : files(path);
    if (!entry.isFile() || ![".ts", ".tsx", ".js", ".mjs"].includes(extname(path)) || /\.test\.[^.]+$/u.test(path)) return [];
    return [path];
  });
}

for (const root of roots) {
  for (const file of files(root)) {
    const normalized = relative(".", file).replaceAll("/", "\\");
    const source = readFileSync(file, "utf8");
    if (/\bScanCommand\b|\.scan\s*\(/u.test(source) && normalized !== allowedGuard) violations.push(`${normalized}: Scan no está permitido en flujos normales.`);
  }
}

const guard = readFileSync(allowedGuard, "utf8");
if (!guard.includes("command instanceof ScanCommand") || !guard.includes("ScanCommand está prohibido")) violations.push("El adaptador no conserva la defensa explícita contra ScanCommand.");

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("No-Scan check passed for production sources.\n");
}
