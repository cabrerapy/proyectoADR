import { App } from "aws-cdk-lib";
import path from "node:path";

import {
  resolveEnvironmentConfig,
  type EnvironmentConfig,
} from "./config/environment.js";
import {
  resolveWebHostingArtifacts,
  type WebHostingArtifacts,
} from "./hosting/web-hosting-artifacts.js";
import { GymPlatformStack } from "./stacks/gym-platform-stack.js";

export interface InfrastructureApplication {
  readonly config: EnvironmentConfig;
  readonly stack: GymPlatformStack;
}

export interface CreateInfrastructureOptions {
  readonly webHostingArtifacts?: WebHostingArtifacts;
}

export const createInfrastructure = (
  app: App,
  options: CreateInfrastructureOptions = {},
): InfrastructureApplication => {
  const config = resolveEnvironmentConfig(
    app.node.tryGetContext("environment"),
  );
  const stack = new GymPlatformStack(app, "GymPlatformStack", {
    environmentConfig: config,
    webHostingArtifacts:
      options.webHostingArtifacts ??
      resolveWebHostingArtifacts(
        path.resolve(process.cwd(), "../apps/web/.open-next"),
      ),
  });

  return { config, stack };
};
