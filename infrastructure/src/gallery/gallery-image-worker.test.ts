import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInfrastructure } from "../infrastructure-app.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../test-fixtures/open-next");
const synthesize = () => Template.fromStack(createInfrastructure(new App({ context: { environment: "development" } }), { webHostingArtifacts: { imageOptimizationFunctionPath: path.join(fixtureRoot, "image-optimization-function"), serverFunctionPath: path.join(fixtureRoot, "server-functions", "default"), staticAssetsPath: path.join(fixtureRoot, "assets") } }).stack);

describe("gallery image worker", () => {
  it("creates a bounded container Lambda consuming SQS with partial failures", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ APP_ENVIRONMENT: "development", DYNAMODB_TABLE_NAME: Match.anyValue(), GALLERY_DERIVATIVES_BUCKET_NAME: Match.anyValue(), GALLERY_ORIGINALS_BUCKET_NAME: Match.anyValue() }) },
      MemorySize: 2048,
      PackageType: "Image",
      ReservedConcurrentExecutions: 2,
      Timeout: 120,
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("uses exact application IAM actions and resources", () => {
    const policies = Object.values(synthesize().findResources("AWS::IAM::Policy"));
    const serialized = JSON.stringify(policies.filter((resource) => JSON.stringify(resource).includes("GalleryImageWorkerRole")));
    expect(serialized).toContain("dynamodb:GetItem");
    expect(serialized).toContain("dynamodb:TransactWriteItems");
    expect(serialized).toContain("s3:GetObjectVersion");
    expect(serialized).toContain("s3:PutObject");
    expect(serialized).toContain("gallery/originals/*");
    expect(serialized).toContain("gallery/derived/*");
    expect(serialized).not.toContain("dynamodb:*");
    expect(serialized).not.toContain("s3:*");
  });
});
