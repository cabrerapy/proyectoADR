import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInfrastructure } from "../infrastructure-app.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../test-fixtures/open-next");
const template = () => Template.fromStack(createInfrastructure(new App({ context: { environment: "development" } }), { webHostingArtifacts: { imageOptimizationFunctionPath: path.join(fixtureRoot, "image-optimization-function"), serverFunctionPath: path.join(fixtureRoot, "server-functions", "default"), staticAssetsPath: path.join(fixtureRoot, "assets") } }).stack);

describe("notification delivery IAM", () => {
  it("limits SES and DynamoDB permissions to exact operations and resources", () => {
    const serialized = JSON.stringify(template().findResources("AWS::IAM::Policy"));
    expect(serialized).toContain("ses:SendEmail");
    expect(serialized).toContain("dynamodb:TransactWriteItems");
    expect(serialized).toContain("GSI1-Operational");
    expect(serialized).not.toContain("dynamodb:*");
    expect(serialized).not.toContain("ses:*");
    expect(serialized).not.toContain('"Resource":"*"');
  });
});
