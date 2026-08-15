import { ArnFormat, Stack, type StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import { CognitoAuth } from "../auth/cognito-auth.js";
import type { EnvironmentConfig } from "../config/environment.js";
import { DynamoDbTable } from "../database/dynamodb-table.js";
import { SecurityFoundation } from "../foundation/security-foundation.js";
import type { WebHostingArtifacts } from "../hosting/web-hosting-artifacts.js";
import { WebHosting } from "../hosting/web-hosting.js";
import { GalleryStorage, galleryOriginalsPrefix } from "../gallery/gallery-storage.js";
import { GalleryImageWorker } from "../gallery/gallery-image-worker.js";
import { NotificationDelivery } from "../notifications/notification-delivery.js";
import { ExpiryReminderSchedule } from "../notifications/expiry-reminder-schedule.js";

export interface GymPlatformStackProps extends StackProps {
  readonly environmentConfig: EnvironmentConfig;
  readonly webHostingArtifacts: WebHostingArtifacts;
}

export class GymPlatformStack extends Stack {
  readonly cognitoAuth: CognitoAuth;
  readonly dynamoDbTable: DynamoDbTable;
  readonly environmentConfig: EnvironmentConfig;
  readonly galleryStorage: GalleryStorage;
  readonly galleryImageWorker: GalleryImageWorker;
  readonly notificationDelivery: NotificationDelivery;
  readonly expiryReminderSchedule: ExpiryReminderSchedule;
  readonly securityFoundation: SecurityFoundation;
  readonly webHosting: WebHosting;

  constructor(
    scope: Construct,
    id: string,
    props: GymPlatformStackProps,
  ) {
    super(scope, id, {
      description: `Gym ADR Platform (${props.environmentConfig.name})`,
      stackName: props.environmentConfig.stackName,
      terminationProtection: props.environmentConfig.terminationProtection,
    });

    this.environmentConfig = props.environmentConfig;
    this.securityFoundation = new SecurityFoundation(
      this,
      "SecurityFoundation",
      { environmentConfig: props.environmentConfig },
    );
    this.dynamoDbTable = new DynamoDbTable(this, "DynamoDbTable", {
      encryptionKey: this.securityFoundation.encryptionKey,
      environmentConfig: props.environmentConfig,
    });
    this.webHosting = new WebHosting(this, "WebHosting", {
      artifacts: props.webHostingArtifacts,
      environmentConfig: props.environmentConfig,
      securityFoundation: this.securityFoundation,
    });
    this.galleryStorage = new GalleryStorage(this, "GalleryStorage", {
      environmentConfig: props.environmentConfig,
      securityFoundation: this.securityFoundation,
    });
    this.galleryImageWorker = new GalleryImageWorker(this, "GalleryImageWorker", {
      dynamoDbTable: this.dynamoDbTable,
      environmentConfig: props.environmentConfig,
      securityFoundation: this.securityFoundation,
      storage: this.galleryStorage,
    });
    this.notificationDelivery = new NotificationDelivery(this, "NotificationDelivery", {
      dynamoDbTable: this.dynamoDbTable,
    });
    this.expiryReminderSchedule = new ExpiryReminderSchedule(this, "ExpiryReminderSchedule", {
      delivery: this.notificationDelivery,
      dynamoDbTable: this.dynamoDbTable,
      environmentConfig: props.environmentConfig,
    });
    this.cognitoAuth = new CognitoAuth(this, "CognitoAuth", {
      environmentConfig: props.environmentConfig,
      webBaseUrl: `https://${this.webHosting.distribution.distributionDomainName}`,
    });

    const authParameterPrefix = `/gym-adr-platform/${props.environmentConfig.name}/auth`;
    const authParameterNames = [
      `${authParameterPrefix}/app-base-url`,
      `${authParameterPrefix}/client-id`,
      `${authParameterPrefix}/hosted-ui-base-url`,
      `${authParameterPrefix}/redirect-uri`,
      `${authParameterPrefix}/user-pool-id`,
    ] as const;
    const authParameterDefinitions: readonly (readonly [string, string, string])[] = [
      ["AuthAppBaseUrl", authParameterNames[0], this.cognitoAuth.appBaseUrl],
      ["AuthClientId", authParameterNames[1], this.cognitoAuth.client.userPoolClientId],
      ["AuthHostedUiBaseUrl", authParameterNames[2], this.cognitoAuth.domain.baseUrl()],
      ["AuthRedirectUri", authParameterNames[3], this.cognitoAuth.callbackUrl],
      ["AuthUserPoolId", authParameterNames[4], this.cognitoAuth.userPool.userPoolId],
    ];
    authParameterDefinitions.forEach(([id, parameterName, stringValue]) => {
      new StringParameter(this, id, { parameterName, stringValue });
    });

    this.webHosting.serverFunction.addEnvironment(
      "APP_ENVIRONMENT",
      props.environmentConfig.name,
    );
    this.webHosting.serverFunction.addEnvironment(
      "AUTH_CONFIG_PARAMETER_PREFIX",
      authParameterPrefix,
    );
    this.webHosting.serverFunction.addEnvironment(
      "DYNAMODB_TABLE_NAME",
      this.dynamoDbTable.table.tableName,
    );
    this.webHosting.serverFunction.addEnvironment(
      "GALLERY_ORIGINALS_BUCKET_NAME",
      this.galleryStorage.originalsBucket.bucketName,
    );
    this.webHosting.serverFunction.addEnvironment(
      "SEARCH_TOKEN_SECRET_ARN",
      this.securityFoundation.searchTokenSecret.secretArn,
    );
    this.webHosting.serverFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:BatchGetItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:TransactWriteItems",
        ],
        resources: [this.dynamoDbTable.table.tableArn],
      }),
    );
    this.webHosting.serverFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${this.dynamoDbTable.table.tableArn}/index/*`],
      }),
    );
    this.webHosting.serverFunction.addToRolePolicy(new PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [this.galleryStorage.originalsBucket.arnForObjects(`${galleryOriginalsPrefix}*`)],
    }));
    this.webHosting.serverFunction.addToRolePolicy(new PolicyStatement({
      actions: ["kms:GenerateDataKey"],
      resources: [this.securityFoundation.encryptionKey.keyArn],
    }));
    this.securityFoundation.searchTokenSecret.grantRead(
      this.securityFoundation.applicationRuntimeRole,
    );
    this.webHosting.serverFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: authParameterNames.map((parameterName) =>
          Stack.of(this).formatArn({
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            resource: "parameter",
            resourceName: parameterName.replace(/^\//u, ""),
            service: "ssm",
          })
        ),
      }),
    );
  }
}
