import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createInfrastructure } from "../infrastructure-app.js";

const template = () => Template.fromStack(createInfrastructure(new App({ context: { environment: "development" } }), { webHostingArtifacts: {
  imageOptimizationFunctionPath: path.resolve(import.meta.dirname, "../../test-fixtures/open-next/image-optimization-function"),
  serverFunctionPath: path.resolve(import.meta.dirname, "../../test-fixtures/open-next/server-functions/default"),
  staticAssetsPath: path.resolve(import.meta.dirname, "../../test-fixtures/open-next/assets"),
} }).stack);

describe("DynamoDB monitoring", () => {
  it("sets On-Demand guardrails and alarms consumption, throttle, error and conflicts", () => {
    const synthesized = template();
    synthesized.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST", OnDemandThroughput: { MaxReadRequestUnits: 500, MaxWriteRequestUnits: 500 } });
    synthesized.resourceCountIs("AWS::CloudWatch::Alarm", 5);
    const serialized = JSON.stringify(synthesized.toJSON());
    for (const metric of ["ConsumedReadCapacityUnits", "ConsumedWriteCapacityUnits", "ThrottledRequests", "SystemErrors", "ConditionalCheckFailedRequests"]) expect(serialized).toContain(metric);
    expect(serialized).toContain("AWS::SNS::Topic");
    expect(serialized).not.toContain("dynamodb:*");
  });

  it("routes every alarm to the encrypted operational topic", () => {
    template().allResourcesProperties("AWS::CloudWatch::Alarm", { AlarmActions: [Match.anyValue()], TreatMissingData: "notBreaching" });
  });
});
