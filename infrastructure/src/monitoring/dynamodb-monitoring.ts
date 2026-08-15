import { Duration } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";
import type { DynamoDbTable } from "../database/dynamodb-table.js";

export interface DynamoDbMonitoringProps { readonly alertsTopic: ITopic; readonly dynamoDbTable: DynamoDbTable; readonly environmentConfig: EnvironmentConfig }

export class DynamoDbMonitoring extends Construct {
  constructor(scope: Construct, id: string, props: DynamoDbMonitoringProps) {
    super(scope, id);
    const dimensionsMap = { TableName: props.dynamoDbTable.table.tableName };
    const alarm = (id: string, metricName: string, threshold: number, period: Duration, evaluationPeriods: number) => new Alarm(this, id, {
      alarmDescription: `${metricName} for the environment DynamoDB table.`, alarmName: `gym-adr-${props.environmentConfig.name}-${metricName}`, comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods,
      metric: new Metric({ dimensionsMap, metricName, namespace: "AWS/DynamoDB", period, statistic: "Sum" }), threshold, treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    const alarms = [
      alarm("ReadConsumptionAlarm", "ConsumedReadCapacityUnits", props.environmentConfig.dynamoDbMaxReadRequestUnits * 60 * 0.8, Duration.minutes(1), 2),
      alarm("WriteConsumptionAlarm", "ConsumedWriteCapacityUnits", props.environmentConfig.dynamoDbMaxWriteRequestUnits * 60 * 0.8, Duration.minutes(1), 2),
      alarm("ThrottleAlarm", "ThrottledRequests", 1, Duration.minutes(1), 1),
      alarm("SystemErrorAlarm", "SystemErrors", 1, Duration.minutes(1), 1),
      alarm("ConditionalConflictAlarm", "ConditionalCheckFailedRequests", 10, Duration.minutes(5), 2),
    ];
    for (const item of alarms) item.addAlarmAction(new SnsAction(props.alertsTopic));
  }
}
