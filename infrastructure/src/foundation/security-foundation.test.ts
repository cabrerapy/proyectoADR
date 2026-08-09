import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { DeploymentEnvironmentName } from "../config/environment.js";
import { createInfrastructure } from "../infrastructure-app.js";

const synthesize = (environment: DeploymentEnvironmentName) => {
  const app = new App({ context: { environment } });
  return Template.fromStack(
    createInfrastructure(app, {
      webHostingArtifacts: {
        imageOptimizationFunctionPath: path.resolve(
          import.meta.dirname,
          "../../test-fixtures/open-next/image-optimization-function",
        ),
        serverFunctionPath: path.resolve(
          import.meta.dirname,
          "../../test-fixtures/open-next/server-functions/default",
        ),
        staticAssetsPath: path.resolve(
          import.meta.dirname,
          "../../test-fixtures/open-next/assets",
        ),
      },
    }).stack,
  );
};

describe("security foundation", () => {
  it.each([
    ["local", 5, 30],
    ["development", 25, 30],
    ["production", 100, 90],
  ] as const)(
    "configures cost and log retention controls for %s",
    (environment, budgetAmount, retentionDays) => {
      const template = synthesize(environment);

      template.hasResourceProperties("AWS::Budgets::Budget", {
        Budget: {
          BudgetLimit: { Amount: budgetAmount, Unit: "USD" },
          BudgetName: `gym-adr-platform-${environment}-monthly`,
          BudgetType: "COST",
          CostFilters: {
            TagKeyValue: [`user:Environment$${environment}`],
          },
          TimeUnit: "MONTHLY",
        },
      });
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("EncryptionKey"), "Arn"] },
        LogGroupName: `/gym-adr-platform/${environment}/application`,
        RetentionInDays: retentionDays,
      });
    },
  );

  it("uses a rotating KMS key and encrypted alert topic", () => {
    const template = synthesize("development");

    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              "kms:Decrypt",
              "kms:DescribeKey",
              "kms:Encrypt",
              "kms:GenerateDataKey*",
              "kms:ReEncrypt*",
            ],
            Condition: Match.objectLike({ ArnEquals: Match.anyValue() }),
            Effect: "Allow",
            Principal: Match.objectLike({ Service: Match.anyValue() }),
            Resource: "*",
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::SNS::Topic", {
      KmsMasterKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("EncryptionKey"), "Arn"] },
      TopicName: "gym-adr-platform-development-alerts",
    });
  });

  it("keeps runtime log access scoped to its exact log group", () => {
    const template = synthesize("development");

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
          }),
        ],
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Effect: "Allow",
            Resource: Match.objectLike({ "Fn::GetAtt": Match.anyValue() }),
          }),
        ]),
      },
      Roles: Match.anyValue(),
    });

    const resources = template.toJSON().Resources as Record<
      string,
      string | unknown
    >;
    const policies = Object.values(resources).filter(
      (resource): resource is { Type: string } =>
        typeof resource === "object" &&
        resource !== null &&
        "Type" in resource &&
        resource.Type === "AWS::IAM::Policy",
    );

    expect(JSON.stringify(policies)).not.toContain('"Resource":"*"');
    expect(JSON.stringify(policies)).not.toContain("dynamodb:*");
  });

  it("applies mandatory cost-allocation tags", () => {
    const template = synthesize("development");
    const resources = template.toJSON().Resources as Record<
      string,
      { Type?: string; Properties?: Record<string, unknown> }
    >;
    const expectedTags = new Map([
      ["CostCenter", "gym-adr"],
      ["Environment", "development"],
      ["Owner", "gym-adr-team"],
      ["Project", "gym-adr-platform"],
    ]);

    for (const resourceType of [
      "AWS::KMS::Key",
      "AWS::Logs::LogGroup",
      "AWS::Budgets::Budget",
    ]) {
      const resource = Object.values(resources).find(
        (candidate) => candidate.Type === resourceType,
      );
      const tagProperty =
        resourceType === "AWS::Budgets::Budget" ? "ResourceTags" : "Tags";
      const tags = resource?.Properties?.[tagProperty] as
        | { Key: string; Value: string }[]
        | undefined;

      expect(tags).toBeDefined();
      for (const [key, value] of expectedTags) {
        expect(tags).toContainEqual({ Key: key, Value: value });
      }
    }
  });

  it("retains stateful foundation resources only in production", () => {
    const development = synthesize("development").toJSON().Resources as Record<
      string,
      { Type?: string; DeletionPolicy?: string }
    >;
    const production = synthesize("production").toJSON().Resources as Record<
      string,
      { Type?: string; DeletionPolicy?: string }
    >;

    for (const resourceType of ["AWS::KMS::Key", "AWS::Logs::LogGroup"]) {
      expect(
        Object.values(development).find(
          (resource) => resource.Type === resourceType,
        )?.DeletionPolicy,
      ).toBe("Delete");
      expect(
        Object.values(production).find(
          (resource) => resource.Type === resourceType,
        )?.DeletionPolicy,
      ).toBe("Retain");
    }
  });
});
