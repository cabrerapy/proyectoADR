import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const supportedExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const supportedNames = new Set([
  ".editorconfig",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
]);

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => file !== "package-lock.json")
  .filter(
    (file) => supportedExtensions.has(extname(file)) || supportedNames.has(file),
  );

const violations = [];

for (const file of files) {
  const contents = readFileSync(file, "utf8");

  if (contents.includes("\r\n")) {
    violations.push(`${file}: use LF line endings`);
  }

  if (contents.length > 0 && !contents.endsWith("\n")) {
    violations.push(`${file}: add a final newline`);
  }

  if (/[ \t]+$/gmu.test(contents)) {
    violations.push(`${file}: remove trailing whitespace`);
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Format checks passed for ${files.length} files.\n`);
}
