import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const workspaceRules = new Map([
  ["@gym-adr/shared", { directory: "packages/shared", allowed: [] }],
  [
    "@gym-adr/validation",
    { directory: "packages/validation", allowed: ["@gym-adr/shared"] },
  ],
  [
    "@gym-adr/domain",
    { directory: "packages/domain", allowed: ["@gym-adr/shared"] },
  ],
  [
    "@gym-adr/data-access",
    {
      directory: "packages/data-access",
      allowed: ["@gym-adr/domain", "@gym-adr/shared"],
    },
  ],
  [
    "@gym-adr/image-worker",
    {
      directory: "packages/image-worker",
      allowed: ["@gym-adr/data-access"],
    },
  ],
  [
    "@gym-adr/notification-worker",
    {
      directory: "packages/notification-worker",
      allowed: ["@gym-adr/data-access", "@gym-adr/domain"],
    },
  ],
  [
    "@gym-adr/operations",
    { directory: "packages/operations", allowed: ["@gym-adr/data-access"] },
  ],
  ["@gym-adr/infrastructure", { directory: "infrastructure", allowed: [] }],
]);

const dependencyGraph = new Map();
const violations = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

for (const [name, rule] of workspaceRules) {
  const manifest = readJson(join(rule.directory, "package.json"));
  if (manifest.name !== name) {
    violations.push(`${rule.directory}: expected package name ${name}`);
  }
  if (manifest.private !== true) {
    violations.push(`${name}: workspace must be private`);
  }

  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const internal = [...declared].filter((dependency) =>
    dependency.startsWith("@gym-adr/"),
  );
  dependencyGraph.set(name, internal);

  for (const dependency of internal) {
    if (!rule.allowed.includes(dependency)) {
      violations.push(`${name}: dependency ${dependency} is not allowed`);
    }
  }

  for (const file of listTypeScriptFiles(join(rule.directory, "src"))) {
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(/from\s+["'](@gym-adr\/[^"']+)["']/gu);
    for (const match of imports) {
      const dependency = match[1];
      if (!declared.has(dependency)) {
        violations.push(`${file}: undeclared workspace import ${dependency}`);
      }
    }
  }
}

const visiting = new Set();
const visited = new Set();

function visit(name, path) {
  if (visiting.has(name)) {
    violations.push(`dependency cycle: ${[...path, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) {
    return;
  }

  visiting.add(name);
  for (const dependency of dependencyGraph.get(name) ?? []) {
    visit(dependency, [...path, name]);
  }
  visiting.delete(name);
  visited.add(name);
}

for (const name of workspaceRules.keys()) {
  visit(name, []);
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Workspace boundaries passed for ${workspaceRules.size} packages.\n`,
  );
}
