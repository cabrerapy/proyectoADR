import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";
import { SecurityFoundation } from "../foundation/security-foundation.js";
import type { WebHostingArtifacts } from "../hosting/web-hosting-artifacts.js";
import { WebHosting } from "../hosting/web-hosting.js";

export interface GymPlatformStackProps extends StackProps {
  readonly environmentConfig: EnvironmentConfig;
  readonly webHostingArtifacts: WebHostingArtifacts;
}

export class GymPlatformStack extends Stack {
  readonly environmentConfig: EnvironmentConfig;
  readonly securityFoundation: SecurityFoundation;
  readonly webHosting: WebHosting;

  constructor(
    scope: Construct,
    id: string,
    props: GymPlatformStackProps,
  ) {
    super(scope, id, {
      description: `Gym ADR Platform (${props.environmentConfig.name})`,
      stackName: props.environmentConfig.stackName,
      terminationProtection: props.environmentConfig.terminationProtection,
    });

    this.environmentConfig = props.environmentConfig;
    this.securityFoundation = new SecurityFoundation(
      this,
      "SecurityFoundation",
      { environmentConfig: props.environmentConfig },
    );
    this.webHosting = new WebHosting(this, "WebHosting", {
      artifacts: props.webHostingArtifacts,
      environmentConfig: props.environmentConfig,
      securityFoundation: this.securityFoundation,
    });
  }
}
