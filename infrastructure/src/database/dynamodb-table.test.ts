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

const primaryKey = [
  { AttributeName: "PK", KeyType: "HASH" },
  { AttributeName: "SK", KeyType: "RANGE" },
];

describe("DynamoDB table", () => {
  it.each(["local", "development", "production"] as const)(
    "creates one isolated On-Demand table for %s",
    (environment) => {
      const template = synthesize(environment);

      template.resourceCountIs("AWS::DynamoDB::Table", 1);
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: primaryKey,
        SSESpecification: {
          KMSMasterKeyId: {
            "Fn::GetAtt": [Match.stringLikeRegexp("EncryptionKey"), "Arn"],
          },
          SSEEnabled: true,
          SSEType: "KMS",
        },
        TableName: `gym-adr-platform-${environment}`,
      });
    },
  );

  it("defines only the two approved sparse KEYS_ONLY indexes", () => {
    const template = synthesize("development");

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
        { AttributeName: "GSI2PK", AttributeType: "S" },
        { AttributeName: "GSI2SK", AttributeType: "S" },
      ]),
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1-Operational",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
        {
          IndexName: "GSI2-Relationships",
          KeySchema: [
            { AttributeName: "GSI2PK", KeyType: "HASH" },
            { AttributeName: "GSI2SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ],
    });
  });

  it("enables PITR, deletion protection, and retention only in production", () => {
    const development = synthesize("development").toJSON()
      .Resources as Record<
      string,
      {
        DeletionPolicy?: string;
        Properties?: Record<string, unknown>;
        Type?: string;
        UpdateReplacePolicy?: string;
      }
    >;
    const production = synthesize("production").toJSON().Resources as typeof development;
    const findTable = (resources: typeof development) =>
      Object.values(resources).find(
        (resource) => resource.Type === "AWS::DynamoDB::Table",
      );
    const developmentTable = findTable(development);
    const productionTable = findTable(production);

    expect(developmentTable).toMatchObject({
      DeletionPolicy: "Delete",
      Properties: {
        DeletionProtectionEnabled: false,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: false,
        },
      },
      UpdateReplacePolicy: "Delete",
    });
    expect(productionTable).toMatchObject({
      DeletionPolicy: "Retain",
      Properties: {
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      },
      UpdateReplacePolicy: "Retain",
    });
  });

  it("applies mandatory cost-allocation tags without adding DynamoDB IAM grants", () => {
    const template = synthesize("development");
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([
        { Key: "CostCenter", Value: "gym-adr" },
        { Key: "Environment", Value: "development" },
        { Key: "ManagedBy", Value: "aws-cdk" },
        { Key: "Owner", Value: "gym-adr-team" },
        { Key: "Project", Value: "gym-adr-platform" },
      ]),
    });

    const resources = template.toJSON().Resources as Record<
      string,
      { Type?: string }
    >;
    const policies = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::IAM::Policy",
    );
    expect(JSON.stringify(policies)).not.toContain("dynamodb:");
  });
});
