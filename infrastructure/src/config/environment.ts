export const deploymentEnvironmentNames = [
  "local",
  "development",
  "production",
] as const;

export type DeploymentEnvironmentName =
  (typeof deploymentEnvironmentNames)[number];

export interface EnvironmentConfig {
  readonly name: DeploymentEnvironmentName;
  readonly stackName: string;
  readonly terminationProtection: boolean;
}

const environmentConfigs = {
  local: {
    name: "local",
    stackName: "gym-adr-platform-local",
    terminationProtection: false,
  },
  development: {
    name: "development",
    stackName: "gym-adr-platform-development",
    terminationProtection: false,
  },
  production: {
    name: "production",
    stackName: "gym-adr-platform-production",
    terminationProtection: true,
  },
} as const satisfies Record<DeploymentEnvironmentName, EnvironmentConfig>;

const isEnvironmentName = (
  value: unknown,
): value is DeploymentEnvironmentName =>
  typeof value === "string" &&
  deploymentEnvironmentNames.some((name) => name === value);

export const resolveEnvironmentConfig = (
  value: unknown,
): EnvironmentConfig => {
  if (!isEnvironmentName(value)) {
    throw new Error(
      `CDK context "environment" must be one of: ${deploymentEnvironmentNames.join(", ")}.`,
    );
  }

  return environmentConfigs[value];
};
