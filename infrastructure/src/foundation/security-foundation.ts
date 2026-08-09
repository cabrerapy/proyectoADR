import {
  Arn,
  ArnFormat,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Alias, Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";

const projectName = "gym-adr-platform";

const requiredTags = {
  CostCenter: "gym-adr",
  ManagedBy: "aws-cdk",
  Owner: "gym-adr-team",
  Project: projectName,
} as const;

export interface SecurityFoundationProps {
  readonly environmentConfig: EnvironmentConfig;
}

export class SecurityFoundation extends Construct {
  readonly applicationLogGroup: LogGroup;
  readonly applicationRuntimeRole: Role;
  readonly encryptionKey: Key;
  readonly operationalAlertsTopic: Topic;
  readonly searchTokenSecret: Secret;

  constructor(
    scope: Construct,
    id: string,
    props: SecurityFoundationProps,
  ) {
    super(scope, id);

    const { environmentConfig } = props;
    const retain = environmentConfig.name === "production";
    const removalPolicy = retain
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
    const logGroupName = `/${projectName}/${environmentConfig.name}/application`;

    this.encryptionKey = new Key(this, "EncryptionKey", {
      description: `Foundation encryption key for ${projectName} (${environmentConfig.name})`,
      enableKeyRotation: true,
      pendingWindow: Duration.days(7),
      removalPolicy,
    });

    this.encryptionKey.addToResourcePolicy(
      new PolicyStatement({
        actions: [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*",
        ],
        conditions: {
          ArnEquals: {
            "kms:EncryptionContext:aws:logs:arn": Arn.format(
              {
                arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                resource: "log-group",
                resourceName: logGroupName,
                service: "logs",
              },
              Stack.of(this),
            ),
          },
        },
        effect: Effect.ALLOW,
        principals: [
          new ServicePrincipal(
            `logs.${Stack.of(this).region}.${Stack.of(this).urlSuffix}`,
          ),
        ],
        resources: ["*"],
      }),
    );

    this.encryptionKey.addToResourcePolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
        conditions: {
          StringEquals: {
            "kms:CallerAccount": Stack.of(this).account,
            "kms:ViaService": `sns.${Stack.of(this).region}.${Stack.of(this).urlSuffix}`,
          },
        },
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("sns.amazonaws.com")],
        resources: ["*"],
      }),
    );

    new Alias(this, "EncryptionKeyAlias", {
      aliasName: `alias/${projectName}/${environmentConfig.name}/foundation`,
      targetKey: this.encryptionKey,
    });

    this.searchTokenSecret = new Secret(this, "SearchTokenSecret", {
      description: `HMAC key for private search tokens (${environmentConfig.name})`,
      encryptionKey: this.encryptionKey,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
      removalPolicy,
      secretName: `${projectName}/${environmentConfig.name}/search-token-hmac`,
    });

    this.applicationLogGroup = new LogGroup(this, "ApplicationLogGroup", {
      encryptionKey: this.encryptionKey,
      logGroupName,
      removalPolicy,
      retention:
        environmentConfig.logRetentionDays === 90
          ? RetentionDays.THREE_MONTHS
          : RetentionDays.ONE_MONTH,
    });

    this.applicationRuntimeRole = new Role(this, "ApplicationRuntimeRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: `Minimal runtime role for ${projectName} (${environmentConfig.name})`,
    });
    this.applicationLogGroup.grantWrite(this.applicationRuntimeRole);

    this.operationalAlertsTopic = new Topic(this, "OperationalAlertsTopic", {
      displayName: `${projectName}-${environmentConfig.name}-alerts`,
      masterKey: this.encryptionKey,
      topicName: `${projectName}-${environmentConfig.name}-alerts`,
    });
    const budgetPublishGrant = this.operationalAlertsTopic.addToResourcePolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": Stack.of(this).account,
          },
        },
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        resources: [this.operationalAlertsTopic.topicArn],
      }),
    );

    const budget = new CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetLimit: {
          amount: environmentConfig.monthlyBudgetUsd,
          unit: "USD",
        },
        budgetName: `${projectName}-${environmentConfig.name}-monthly`,
        budgetType: "COST",
        costFilters: {
          TagKeyValue: [`user:Environment$${environmentConfig.name}`],
        },
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "FORECASTED",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              address: this.operationalAlertsTopic.topicArn,
              subscriptionType: "SNS",
            },
          ],
        },
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              address: this.operationalAlertsTopic.topicArn,
              subscriptionType: "SNS",
            },
          ],
        },
      ],
      resourceTags: [
        ...Object.entries(requiredTags).map(([key, value]) => ({ key, value })),
        { key: "Environment", value: environmentConfig.name },
      ],
    });
    if (budgetPublishGrant.policyDependable) {
      budget.node.addDependency(budgetPublishGrant.policyDependable);
    }

    for (const [key, value] of Object.entries(requiredTags)) {
      Tags.of(this).add(key, value);
    }
    Tags.of(this).add("Environment", environmentConfig.name);
  }
}
