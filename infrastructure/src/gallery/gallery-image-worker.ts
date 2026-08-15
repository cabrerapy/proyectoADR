import { Duration, IgnoreMode } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import path from "node:path";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config/environment.js";
import type { DynamoDbTable } from "../database/dynamodb-table.js";
import type { SecurityFoundation } from "../foundation/security-foundation.js";
import { galleryDerivativesPrefix, galleryOriginalsPrefix, type GalleryStorage } from "./gallery-storage.js";

export interface GalleryImageWorkerProps {
  readonly dynamoDbTable: DynamoDbTable;
  readonly environmentConfig: EnvironmentConfig;
  readonly securityFoundation: SecurityFoundation;
  readonly storage: GalleryStorage;
}

export class GalleryImageWorker extends Construct {
  readonly function: DockerImageFunction;
  readonly role: Role;

  constructor(scope: Construct, id: string, props: GalleryImageWorkerProps) {
    super(scope, id);
    this.role = new Role(this, "Role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: `Gallery image worker (${props.environmentConfig.name})`,
    });
    props.securityFoundation.applicationLogGroup.grantWrite(this.role);
    this.role.addToPolicy(new PolicyStatement({ actions: ["dynamodb:GetItem", "dynamodb:TransactWriteItems"], resources: [props.dynamoDbTable.table.tableArn] }));
    this.role.addToPolicy(new PolicyStatement({ actions: ["s3:GetObject", "s3:GetObjectVersion"], resources: [props.storage.originalsBucket.arnForObjects(`${galleryOriginalsPrefix}*`)] }));
    this.role.addToPolicy(new PolicyStatement({ actions: ["s3:PutObject"], resources: [props.storage.derivativesBucket.arnForObjects(`${galleryDerivativesPrefix}*`)] }));
    this.role.addToPolicy(new PolicyStatement({ actions: ["kms:Decrypt", "kms:GenerateDataKey"], resources: [props.securityFoundation.encryptionKey.keyArn] }));

    this.function = new DockerImageFunction(this, "Function", {
      code: DockerImageCode.fromImageAsset(path.resolve(import.meta.dirname, "../../.."), {
        exclude: [".git", ".github", "apps", "docs", "infrastructure", "scripts", "packages/validation", "**/*.test.ts", "**/.next", "**/.open-next", "**/cdk.out", "**/dist", "**/node_modules", "playwright-report", "test-results"],
        file: "packages/image-worker/Dockerfile",
        ignoreMode: IgnoreMode.GLOB,
      }),
      description: `Gallery derivative processor (${props.environmentConfig.name})`,
      environment: {
        APP_ENVIRONMENT: props.environmentConfig.name,
        DYNAMODB_TABLE_NAME: props.dynamoDbTable.table.tableName,
        GALLERY_DERIVATIVES_BUCKET_NAME: props.storage.derivativesBucket.bucketName,
        GALLERY_ORIGINALS_BUCKET_NAME: props.storage.originalsBucket.bucketName,
      },
      logGroup: props.securityFoundation.applicationLogGroup,
      memorySize: 2048,
      reservedConcurrentExecutions: 2,
      role: this.role,
      timeout: Duration.minutes(2),
    });
    this.function.addEventSource(new SqsEventSource(props.storage.processingQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
  }
}
