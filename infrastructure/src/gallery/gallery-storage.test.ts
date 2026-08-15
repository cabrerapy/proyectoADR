import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createInfrastructure } from "../infrastructure-app.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../test-fixtures/open-next");

const synthesize = () => {
  const app = new App({ context: { environment: "development" } });
  const stack = createInfrastructure(app, {
    webHostingArtifacts: {
      imageOptimizationFunctionPath: path.join(fixtureRoot, "image-optimization-function"),
      serverFunctionPath: path.join(fixtureRoot, "server-functions", "default"),
      staticAssetsPath: path.join(fixtureRoot, "assets"),
    },
  }).stack;
  return Template.fromStack(stack);
};

describe("private gallery storage", () => {
  it("creates a private versioned KMS bucket with bounded browser uploads", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::S3::Bucket", 3);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({
        BucketKeyEnabled: true,
        ServerSideEncryptionByDefault: { KMSMasterKeyID: Match.anyValue(), SSEAlgorithm: "aws:kms" },
      })] },
      CorsConfiguration: { CorsRules: [Match.objectLike({
        AllowedHeaders: ["content-length", "content-type", "x-amz-meta-assetid", "x-amz-server-side-encryption"],
        AllowedMethods: ["PUT"],
        AllowedOrigins: ["*"],
        MaxAge: 300,
      })] },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: "Enabled" },
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      NotificationConfiguration: { QueueConfigurations: [Match.objectLike({
        Event: "s3:ObjectCreated:*",
        Filter: { S3Key: { Rules: [{ Name: "prefix", Value: "gallery/originals/" }] } },
      })] },
    });
  });

  it("creates a separate private encrypted derivative bucket", () => {
    synthesize().hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" } })] },
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  it("creates an encrypted processing queue and DLQ", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::SQS::Queue", 2);
    template.hasResourceProperties("AWS::SQS::Queue", {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 300,
    });
    template.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({
        Action: "sqs:SendMessage",
        Condition: Match.objectLike({ ArnEquals: Match.anyValue(), StringEquals: Match.anyValue() }),
        Principal: { Service: "s3.amazonaws.com" },
      })]) }),
    });
  });

  it("grants only exact upload access to the web runtime", () => {
    const template = synthesize();
    expect(JSON.stringify(template.toJSON())).toContain("GALLERY_ORIGINALS_BUCKET_NAME");
    const runtimePolicy = Object.values(template.findResources("AWS::IAM::Policy"))
      .find((resource) => {
        const properties = resource.Properties as { PolicyName?: unknown } | undefined;
        return typeof properties?.PolicyName === "string"
          && properties.PolicyName.includes("ApplicationRuntimeRoleDefaultPolicy");
      });
    expect(runtimePolicy).toBeDefined();
    const serialized = JSON.stringify(runtimePolicy);
    expect(serialized).toContain("s3:PutObject");
    expect(serialized).toContain("gallery/originals/*");
    expect(serialized).not.toContain("s3:*");
    expect(serialized).not.toContain("Resource\":\"*");
  });
});
