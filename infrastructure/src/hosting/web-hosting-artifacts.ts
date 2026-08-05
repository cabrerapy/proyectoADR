import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface WebHostingArtifacts {
  readonly imageOptimizationFunctionPath: string;
  readonly serverFunctionPath: string;
  readonly staticAssetsPath: string;
}

const requireDirectory = (directoryPath: string, label: string): void => {
  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    throw new Error(
      `OpenNext ${label} directory is missing at ${directoryPath}. Run the web build:serverless script first.`,
    );
  }
};

const requireDisabledPersistence = (manifest: object): void => {
  const additionalProps = Reflect.get(manifest, "additionalProps");
  if (
    typeof additionalProps !== "object" ||
    additionalProps === null ||
    Reflect.get(additionalProps, "disableIncrementalCache") !== true ||
    Reflect.get(additionalProps, "disableTagCache") !== true
  ) {
    throw new Error(
      "OpenNext output must disable incremental and tag caches until their persistence resources are implemented.",
    );
  }
};

export const resolveWebHostingArtifacts = (
  artifactRoot: string,
): WebHostingArtifacts => {
  const outputManifestPath = path.join(
    artifactRoot,
    "open-next.output.json",
  );
  if (!existsSync(outputManifestPath)) {
    throw new Error(
      `OpenNext output manifest is missing at ${outputManifestPath}. Run the web build:serverless script first.`,
    );
  }

  const manifest: unknown = JSON.parse(readFileSync(outputManifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("OpenNext output manifest must contain a JSON object.");
  }
  requireDisabledPersistence(manifest);

  const artifacts = {
    imageOptimizationFunctionPath: path.join(
      artifactRoot,
      "image-optimization-function",
    ),
    serverFunctionPath: path.join(
      artifactRoot,
      "server-functions",
      "default",
    ),
    staticAssetsPath: path.join(artifactRoot, "assets"),
  } satisfies WebHostingArtifacts;

  requireDirectory(artifacts.imageOptimizationFunctionPath, "image function");
  requireDirectory(artifacts.serverFunctionPath, "server function");
  requireDirectory(artifacts.staticAssetsPath, "static assets");

  return artifacts;
};
