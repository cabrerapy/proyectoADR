import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import {
  deploymentEnvironmentNames,
  resolveEnvironmentConfig,
} from "./config/environment.js";
import { createInfrastructure } from "./infrastructure-app.js";

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
    "creates one environment-specific empty stack for %s",
    (environment) => {
      const app = new App({ context: { environment } });
      const application = createInfrastructure(app);
      const template = Template.fromStack(application.stack).toJSON();

      expect(application.stack.stackName).toBe(
        `gym-adr-platform-${environment}`,
      );
      expect(application.stack.terminationProtection).toBe(
        environment === "production",
      );
      expect(template.Resources ?? {}).toEqual({});
      expect(() => app.synth()).not.toThrow();
    },
  );

  it("requires explicit environment context", () => {
    expect(() => createInfrastructure(new App())).toThrow(
      'CDK context "environment" must be one of: local, development, production.',
    );
  });
});
