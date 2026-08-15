import { Duration, Stack } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import path from "node:path";
import { Construct } from "constructs";

import type { DynamoDbTable } from "../database/dynamodb-table.js";
import type { EnvironmentConfig } from "../config/environment.js";
import type { NotificationDelivery } from "./notification-delivery.js";

export interface ExpiryReminderScheduleProps { readonly delivery: NotificationDelivery; readonly dynamoDbTable: DynamoDbTable; readonly environmentConfig: EnvironmentConfig }
export class ExpiryReminderSchedule extends Construct {
  readonly function: NodejsFunction;
  constructor(scope: Construct, id: string, props: ExpiryReminderScheduleProps) {
    super(scope, id);
    const functionName = `gym-adr-${props.environmentConfig.name}-expiry-reminders`;
    const logs = new LogGroup(this, "Logs", { logGroupName: `/aws/lambda/${functionName}`, retention: props.environmentConfig.name === "production" ? RetentionDays.THREE_MONTHS : RetentionDays.ONE_MONTH });
    props.delivery.role.addToPolicy(new PolicyStatement({ actions: ["logs:CreateLogStream", "logs:PutLogEvents"], resources: [`${logs.logGroupArn}:*`] }));
    this.function = new NodejsFunction(this, "Function", { architecture: Architecture.ARM_64, bundling: { externalModules: [], minify: true, sourceMap: false, target: "node22" }, entry: path.resolve(import.meta.dirname, "../../../packages/notification-worker/src/handler.ts"), environment: { APP_ENVIRONMENT: props.environmentConfig.name, DYNAMODB_TABLE_NAME: props.dynamoDbTable.table.tableName }, functionName, handler: "handler", logGroup: logs, memorySize: 512, role: props.delivery.role, runtime: Runtime.NODEJS_22_X, timeout: Duration.seconds(60) });
    const invokeRole = new Role(this, "InvokeRole", { assumedBy: new ServicePrincipal("scheduler.amazonaws.com") });
    invokeRole.addToPolicy(new PolicyStatement({ actions: ["lambda:InvokeFunction"], resources: [this.function.functionArn] }));
    new CfnSchedule(this, "Daily", { flexibleTimeWindow: { mode: "OFF" }, scheduleExpression: "cron(0 8 * * ? *)", scheduleExpressionTimezone: "America/Asuncion", state: "ENABLED", target: { arn: this.function.functionArn, retryPolicy: { maximumEventAgeInSeconds: 3600, maximumRetryAttempts: 2 }, roleArn: invokeRole.roleArn } });
  }
}
