import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInfrastructure } from "../infrastructure-app.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../test-fixtures/open-next");
const synth = () => Template.fromStack(createInfrastructure(new App({ context: { environment: "development" } }), { webHostingArtifacts: { imageOptimizationFunctionPath: path.join(fixtureRoot, "image-optimization-function"), serverFunctionPath: path.join(fixtureRoot, "server-functions", "default"), staticAssetsPath: path.join(fixtureRoot, "assets") } }).stack);
describe("expiry reminder schedule", () => {
  it("runs daily in America/Asuncion and invokes only its Lambda", () => { const template = synth(); template.hasResourceProperties("AWS::Scheduler::Schedule", { FlexibleTimeWindow: { Mode: "OFF" }, ScheduleExpression: "cron(0 8 * * ? *)", ScheduleExpressionTimezone: "America/Asuncion", Target: Match.objectLike({ RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 2 } }) }); const serialized = JSON.stringify(template.findResources("AWS::IAM::Policy")); expect(serialized).toContain("lambda:InvokeFunction"); expect(serialized).not.toContain("dynamodb:*"); });
});
