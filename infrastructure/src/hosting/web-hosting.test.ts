import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveWebHostingArtifacts } from "./web-hosting-artifacts.js";
import { createInfrastructure } from "../infrastructure-app.js";

const fixtureRoot = path.resolve(
  import.meta.dirname,
  "../../test-fixtures/open-next",
);

const synthesize = () => {
  const app = new App({ context: { environment: "development" } });
  const stack = createInfrastructure(app, {
    webHostingArtifacts: resolveWebHostingArtifacts(fixtureRoot),
  }).stack;
  return Template.fromStack(stack);
};

describe("OpenNext web hosting", () => {
  it("requires a complete OpenNext artifact", () => {
    expect(() =>
      resolveWebHostingArtifacts(path.join(fixtureRoot, "missing")),
    ).toThrow("OpenNext output manifest is missing");

    expect(resolveWebHostingArtifacts(fixtureRoot)).toEqual({
      imageOptimizationFunctionPath: path.join(
        fixtureRoot,
        "image-optimization-function",
      ),
      serverFunctionPath: path.join(
        fixtureRoot,
        "server-functions",
        "default",
      ),
      staticAssetsPath: path.join(fixtureRoot, "assets"),
    });
  });

  it("creates a private encrypted assets bucket", () => {
    const template = synthesize();

    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          }),
        ],
      },
      OwnershipControls: {
        Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      Tags: Match.arrayWith([
        { Key: "Environment", Value: "development" },
        { Key: "Project", Value: "gym-adr-platform" },
      ]),
    });
  });

  it("creates isolated server and image Lambda functions", () => {
    const template = synthesize();

    template.resourceCountIs("AWS::Lambda::Function", 3);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "OpenNext server (development)",
      Handler: "index.handler",
      MemorySize: 1024,
      Runtime: "nodejs22.x",
      Timeout: 30,
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      Description: "OpenNext image optimization (development)",
      Environment: {
        Variables: Match.objectLike({
          BUCKET_KEY_PREFIX: "_assets",
          BUCKET_NAME: Match.anyValue(),
          BUCKET_REGION: { Ref: "AWS::Region" },
        }),
      },
      MemorySize: 1536,
      Runtime: "nodejs22.x",
    });
    template.resourceCountIs("AWS::Lambda::Url", 2);
    template.allResourcesProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "BUFFERED",
    });
  });

  it("places IAM-protected origins behind one CloudFront distribution", () => {
    const template = synthesize();

    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: "_next/static/*" }),
          Match.objectLike({
            OriginRequestPolicyId: Match.anyValue(),
            PathPattern: "_next/image*",
          }),
        ]),
        DefaultCacheBehavior: Match.objectLike({
          OriginRequestPolicyId: Match.anyValue(),
          ViewerProtocolPolicy: "redirect-to-https",
        }),
        Enabled: true,
        HttpVersion: "http2and3",
        PriceClass: "PriceClass_100",
      }),
    });
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 3);
    template.allResourcesProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunctionUrl",
      Principal: "cloudfront.amazonaws.com",
      SourceArn: Match.anyValue(),
    });
  });

  it("does not grant DynamoDB access before the data tasks", () => {
    const template = synthesize().toJSON();

    expect(JSON.stringify(template)).not.toContain("dynamodb:");
    expect(JSON.stringify(template)).not.toContain("AWS::DynamoDB::Table");
  });
});
