import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => file !== "package-lock.json");

const patterns = [
  {
    name: "AWS access key identifier",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    name: "private key material",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    name: "GitHub token",
    expression: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/gu,
  },
  {
    name: "assigned sensitive value",
    expression:
      /(?:aws_secret_access_key|client_secret|password)\s*[:=]\s*["']?(?!example|placeholder|changeme|dummy|test)[^\s"'`]{8,}/giu,
  },
];

const findings = [];

for (const file of files) {
  let contents;

  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const { name, expression } of patterns) {
    expression.lastIndex = 0;
    if (expression.test(contents)) {
      findings.push(`${file}: possible ${name}`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret checks passed for ${files.length} files.\n`);
}
