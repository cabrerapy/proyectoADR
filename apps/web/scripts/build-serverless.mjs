import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");
const imageFunctionRoot = path.join(
  webRoot,
  ".open-next",
  "image-optimization-function",
);

const requireNpmCli = () => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath no está disponible; ejecuta este script mediante npm.");
  }

  return npmCli;
};

const runOpenNext = (cwd, environment = process.env) => {
  const result = spawnSync(
    process.execPath,
    [requireNpmCli(), "run", "build:serverless:direct"],
    {
      cwd,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
};

const ensureImageDependencies = () => {
  const sharpPackage = path.join(
    imageFunctionRoot,
    "node_modules",
    "sharp",
    "package.json",
  );
  const sharpLinuxArm64Platform = path.join(
    imageFunctionRoot,
    "node_modules",
    "sharp",
    "vendor",
    "8.14.5",
    "linux-arm64v8",
    "platform.json",
  );
  if (existsSync(sharpPackage) && existsSync(sharpLinuxArm64Platform)) {
    return;
  }

  let lastStatus;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const installRoot = mkdtempSync(
      path.join(os.tmpdir(), "gym-adr-opennext-image-"),
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          requireNpmCli(),
          "install",
          "--package-lock=false",
          "--save=false",
          "sharp@0.32.6",
        ],
        {
          cwd: installRoot,
          env: {
            ...process.env,
            SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
            npm_config_arch: "arm64",
            npm_config_libc: "glibc",
            npm_config_platform: "linux",
            npm_config_target: "18",
          },
          stdio: "inherit",
          windowsHide: true,
        },
      );

      if (result.error) {
        throw result.error;
      }
      lastStatus = result.status ?? 1;
      if (lastStatus === 0) {
        cpSync(
          path.join(installRoot, "node_modules"),
          path.join(imageFunctionRoot, "node_modules"),
          { dereference: true, force: true, recursive: true },
        );
        break;
      }
    } finally {
      rmSync(installRoot, { force: true, recursive: true });
    }
  }

  if (lastStatus !== 0) {
    throw new Error(
      `No fue posible instalar las dependencias de imagen tras tres intentos (${lastStatus ?? "sin código"}).`,
    );
  }

  if (!existsSync(sharpPackage) || !existsSync(sharpLinuxArm64Platform)) {
    throw new Error("El artefacto OpenNext no contiene sharp para Linux ARM64v8.");
  }
};

const findAvailableWindowsDrive = () => {
  for (let code = "Z".charCodeAt(0); code >= "R".charCodeAt(0); code -= 1) {
    const drive = `${String.fromCharCode(code)}:`;
    if (!existsSync(`${drive}\\`)) {
      return drive;
    }
  }

  throw new Error("No hay una unidad temporal disponible entre R: y Z:.");
};

if (process.platform !== "win32") {
  const status = runOpenNext(webRoot);
  if (status === 0) {
    ensureImageDependencies();
  }
  process.exitCode = status;
} else {
  const drive = findAvailableWindowsDrive();
  const relativeWebRoot = path.relative(repositoryRoot, webRoot);

  execFileSync("subst.exe", [drive, repositoryRoot], { stdio: "ignore" });
  try {
    const status = runOpenNext(
      path.win32.join(`${drive}\\`, relativeWebRoot),
      {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          "--preserve-symlinks",
          "--preserve-symlinks-main",
        ].filter(Boolean).join(" "),
        OPEN_NEXT_MONOREPO_ROOT: `${drive}\\`,
        OPEN_NEXT_REAL_MONOREPO_ROOT: repositoryRoot,
      },
    );
    if (status === 0) {
      ensureImageDependencies();
    }
    process.exitCode = status;
  } finally {
    execFileSync("subst.exe", [drive, "/D"], { stdio: "ignore" });
  }
}
