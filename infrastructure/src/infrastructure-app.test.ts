import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  deploymentEnvironmentNames,
  resolveEnvironmentConfig,
} from "./config/environment.js";
import { createInfrastructure } from "./infrastructure-app.js";

const webHostingArtifacts = {
  imageOptimizationFunctionPath: path.resolve(
    import.meta.dirname,
    "../test-fixtures/open-next/image-optimization-function",
  ),
  serverFunctionPath: path.resolve(
    import.meta.dirname,
    "../test-fixtures/open-next/server-functions/default",
  ),
  staticAssetsPath: path.resolve(
    import.meta.dirname,
    "../test-fixtures/open-next/assets",
  ),
};

describe("environment configuration", () => {
  it.each(deploymentEnvironmentNames)(
    "resolves the explicit %s environment",
    (environment) => {
      const config = resolveEnvironmentConfig(environment);

      expect(config.name).toBe(environment);
      expect(config.stackName).toBe(`gym-adr-platform-${environment}`);
    },
  );

  it.each([undefined, "", "dev", "staging", 1])(
    "rejects unsupported environment context: %s",
    (environment) => {
      expect(() => resolveEnvironmentConfig(environment)).toThrow(
        'CDK context "environment" must be one of: local, development, production.',
      );
    },
  );
});

describe("CDK application", () => {
  it.each(deploymentEnvironmentNames)(
    "creates one environment-specific foundation stack for %s",
    (environment) => {
      const app = new App({ context: { environment } });
      const application = createInfrastructure(app, { webHostingArtifacts });
      const template = Template.fromStack(application.stack).toJSON();

      expect(application.stack.stackName).toBe(
        `gym-adr-platform-${environment}`,
      );
      expect(application.stack.terminationProtection).toBe(
        environment === "production",
      );
      expect(template.Resources).toBeDefined();
      expect(() => app.synth()).not.toThrow();
    },
  );

  it("requires explicit environment context", () => {
    expect(() =>
      createInfrastructure(new App(), { webHostingArtifacts }),
    ).toThrow(
      'CDK context "environment" must be one of: local, development, production.',
    );
  });
});
