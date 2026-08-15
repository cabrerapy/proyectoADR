import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  CfnBucket,
  HttpMethods,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";
import type { SecurityFoundation } from "../foundation/security-foundation.js";

export const galleryOriginalsPrefix = "gallery/originals/";
export const galleryDerivativesPrefix = "gallery/derived/";

export interface GalleryStorageProps {
  readonly environmentConfig: EnvironmentConfig;
  readonly securityFoundation: SecurityFoundation;
}

export class GalleryStorage extends Construct {
  readonly deadLetterQueue: Queue;
  readonly derivativesBucket: Bucket;
  readonly originalsBucket: Bucket;
  readonly processingQueue: Queue;

  constructor(scope: Construct, id: string, props: GalleryStorageProps) {
    super(scope, id);

    const retain = props.environmentConfig.name === "production";
    const removalPolicy = retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const stack = Stack.of(this);
    const bucketName = `gym-adr-${props.environmentConfig.name}-${stack.account}-${stack.region}-gallery-originals`;

    this.deadLetterQueue = new Queue(this, "ProcessingDeadLetterQueue", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy,
      retentionPeriod: Duration.days(14),
    });
    this.processingQueue = new Queue(this, "ProcessingQueue", {
      deadLetterQueue: { maxReceiveCount: 5, queue: this.deadLetterQueue },
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy,
      retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.minutes(5),
    });
    this.originalsBucket = new Bucket(this, "OriginalsBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName,
      bucketKeyEnabled: true,
      cors: [{
        allowedHeaders: [
          "content-length",
          "content-type",
          "x-amz-meta-assetid",
          "x-amz-server-side-encryption",
        ],
        allowedMethods: [HttpMethods.PUT],
        // CORS does not authorize access; every PUT still requires its short-lived signature.
        allowedOrigins: ["*"],
        exposedHeaders: ["etag"],
        maxAge: 300,
      }],
      encryption: BucketEncryption.KMS,
      encryptionKey: props.securityFoundation.encryptionKey,
      enforceSSL: true,
      lifecycleRules: [{
        abortIncompleteMultipartUploadAfter: Duration.days(1),
        id: "AbortIncompleteUploads",
      }],
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
      versioned: true,
    });
    this.derivativesBucket = new Bucket(this, "DerivativesBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      encryption: BucketEncryption.KMS,
      encryptionKey: props.securityFoundation.encryptionKey,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
      versioned: true,
    });
    const queuePolicy = this.processingQueue.addToResourcePolicy(new PolicyStatement({
      actions: ["sqs:SendMessage"],
      conditions: {
        ArnEquals: {
          "aws:SourceArn": stack.formatArn({
            account: "",
            region: "",
            resource: bucketName,
            service: "s3",
          }),
        },
        StringEquals: { "aws:SourceAccount": stack.account },
      },
      principals: [new ServicePrincipal("s3.amazonaws.com")],
      resources: [this.processingQueue.queueArn],
    }));
    const cfnBucket = this.originalsBucket.node.defaultChild as CfnBucket;
    cfnBucket.notificationConfiguration = {
      queueConfigurations: [{
        event: "s3:ObjectCreated:*",
        filter: {
          s3Key: { rules: [{ name: "prefix", value: galleryOriginalsPrefix }] },
        },
        queue: this.processingQueue.queueArn,
      }],
    };
    if (queuePolicy.policyDependable) {
      cfnBucket.node.addDependency(queuePolicy.policyDependable);
    }
  }
}
