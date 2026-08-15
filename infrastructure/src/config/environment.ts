export const deploymentEnvironmentNames = [
  "local",
  "development",
  "production",
] as const;

export type DeploymentEnvironmentName =
  (typeof deploymentEnvironmentNames)[number];

export interface EnvironmentConfig {
  readonly dynamoDbMaxReadRequestUnits: number;
  readonly dynamoDbMaxWriteRequestUnits: number;
  readonly name: DeploymentEnvironmentName;
  readonly logRetentionDays: 30 | 90;
  readonly monthlyBudgetUsd: number;
  readonly stackName: string;
  readonly terminationProtection: boolean;
}

const environmentConfigs = {
  local: {
    dynamoDbMaxReadRequestUnits: 100,
    dynamoDbMaxWriteRequestUnits: 100,
    name: "local",
    logRetentionDays: 30,
    monthlyBudgetUsd: 5,
    stackName: "gym-adr-platform-local",
    terminationProtection: false,
  },
  development: {
    dynamoDbMaxReadRequestUnits: 500,
    dynamoDbMaxWriteRequestUnits: 500,
    name: "development",
    logRetentionDays: 30,
    monthlyBudgetUsd: 25,
    stackName: "gym-adr-platform-development",
    terminationProtection: false,
  },
  production: {
    dynamoDbMaxReadRequestUnits: 2_000,
    dynamoDbMaxWriteRequestUnits: 2_000,
    name: "production",
    logRetentionDays: 90,
    monthlyBudgetUsd: 100,
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
