import { App } from "aws-cdk-lib";

import {
  resolveEnvironmentConfig,
  type EnvironmentConfig,
} from "./config/environment.js";
import { GymPlatformStack } from "./stacks/gym-platform-stack.js";

export interface InfrastructureApplication {
  readonly config: EnvironmentConfig;
  readonly stack: GymPlatformStack;
}

export const createInfrastructure = (
  app: App,
): InfrastructureApplication => {
  const config = resolveEnvironmentConfig(
    app.node.tryGetContext("environment"),
  );
  const stack = new GymPlatformStack(app, "GymPlatformStack", {
    environmentConfig: config,
  });

  return { config, stack };
};
