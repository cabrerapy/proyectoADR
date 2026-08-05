import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import {
  FunctionUrlOrigin,
  S3BucketOrigin,
} from "aws-cdk-lib/aws-cloudfront-origins";
import {
  Code,
  Function as LambdaFunction,
  FunctionUrlAuthType,
  InvokeMode,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import {
  BucketDeployment,
  CacheControl,
  Source,
} from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";
import type { SecurityFoundation } from "../foundation/security-foundation.js";
import type { WebHostingArtifacts } from "./web-hosting-artifacts.js";

export interface WebHostingProps {
  readonly artifacts: WebHostingArtifacts;
  readonly environmentConfig: EnvironmentConfig;
  readonly securityFoundation: SecurityFoundation;
}

export class WebHosting extends Construct {
  readonly assetsBucket: Bucket;
  readonly distribution: Distribution;
  readonly imageOptimizationFunction: LambdaFunction;
  readonly imageOptimizationRole: Role;
  readonly serverFunction: LambdaFunction;

  constructor(scope: Construct, id: string, props: WebHostingProps) {
    super(scope, id);

    const { environmentConfig, securityFoundation } = props;
    const retain = environmentConfig.name === "production";
    const removalPolicy = retain
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    this.assetsBucket = new Bucket(this, "AssetsBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
    });
    // CDK's Bucket/IBucket declarations differ only in optional-property syntax.
    const assetsBucket = this.assetsBucket as IBucket;

    this.serverFunction = new LambdaFunction(this, "ServerFunction", {
      code: Code.fromAsset(props.artifacts.serverFunctionPath),
      description: `OpenNext server (${environmentConfig.name})`,
      handler: "index.handler",
      logGroup: securityFoundation.applicationLogGroup,
      memorySize: 1024,
      role: securityFoundation.applicationRuntimeRole,
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
    });

    this.imageOptimizationRole = new Role(this, "ImageOptimizationRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: `OpenNext image role (${environmentConfig.name})`,
    });
    securityFoundation.applicationLogGroup.grantWrite(
      this.imageOptimizationRole,
    );
    this.assetsBucket.grantRead(this.imageOptimizationRole);

    this.imageOptimizationFunction = new LambdaFunction(
      this,
      "ImageOptimizationFunction",
      {
        code: Code.fromAsset(props.artifacts.imageOptimizationFunctionPath),
        description: `OpenNext image optimization (${environmentConfig.name})`,
        environment: {
          BUCKET_KEY_PREFIX: "_assets",
          BUCKET_NAME: this.assetsBucket.bucketName,
          BUCKET_REGION: Stack.of(this).region,
        },
        handler: "index.handler",
        logGroup: securityFoundation.applicationLogGroup,
        memorySize: 1536,
        role: this.imageOptimizationRole,
        runtime: Runtime.NODEJS_22_X,
        timeout: Duration.seconds(30),
      },
    );

    const serverUrl = this.serverFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.BUFFERED,
    });
    const imageUrl = this.imageOptimizationFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.BUFFERED,
    });

    const dynamicBehavior = {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      compress: true,
      origin: FunctionUrlOrigin.withOriginAccessControl(serverUrl),
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    } as const;

    this.distribution = new Distribution(this, "Distribution", {
      defaultBehavior: dynamicBehavior,
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
    });
    this.distribution.addBehavior(
      "_next/static/*",
      S3BucketOrigin.withOriginAccessControl(assetsBucket, {
        originPath: "/_assets",
      }),
      {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );
    this.distribution.addBehavior(
      "_next/image*",
      FunctionUrlOrigin.withOriginAccessControl(imageUrl),
      {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        compress: true,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );

    const staticAssetsDeploymentRole = new Role(
      this,
      "StaticAssetsDeploymentRole",
      {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        description: `Static assets deployment role (${environmentConfig.name})`,
      },
    );
    securityFoundation.applicationLogGroup.grantWrite(
      staticAssetsDeploymentRole,
    );

    new BucketDeployment(this, "StaticAssetsDeployment", {
      cacheControl: [
        CacheControl.setPublic(),
        CacheControl.maxAge(Duration.days(1)),
      ],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: "_assets",
      logGroup: securityFoundation.applicationLogGroup,
      prune: true,
      retainOnDelete: retain,
      role: staticAssetsDeploymentRole,
      sources: [Source.asset(props.artifacts.staticAssetsPath)],
    });

    const tags = {
      CostCenter: "gym-adr",
      Environment: environmentConfig.name,
      ManagedBy: "aws-cdk",
      Owner: "gym-adr-team",
      Project: "gym-adr-platform",
    } as const;
    for (const [key, value] of Object.entries(tags)) {
      Tags.of(this).add(key, value);
    }

    new CfnOutput(this, "DistributionDomainName", {
      description: `CloudFront domain for ${environmentConfig.name}`,
      value: this.distribution.distributionDomainName,
    });
  }
}
