import { RemovalPolicy, Tags } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";

const projectName = "gym-adr-platform";

const requiredTags = {
  CostCenter: "gym-adr",
  ManagedBy: "aws-cdk",
  Owner: "gym-adr-team",
  Project: projectName,
} as const;

export const DYNAMODB_INDEX_NAMES = {
  operational: "GSI1-Operational",
  relationships: "GSI2-Relationships",
} as const;

export interface DynamoDbTableProps {
  readonly encryptionKey: IKey;
  readonly environmentConfig: EnvironmentConfig;
}

export class DynamoDbTable extends Construct {
  readonly table: Table;

  constructor(scope: Construct, id: string, props: DynamoDbTableProps) {
    super(scope, id);

    const { environmentConfig } = props;
    const isProduction = environmentConfig.name === "production";

    this.table = new Table(this, "Table", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      deletionProtection: isProduction,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.encryptionKey,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProduction,
      },
      removalPolicy: isProduction
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      sortKey: { name: "SK", type: AttributeType.STRING },
      tableName: `${projectName}-${environmentConfig.name}`,
      timeToLiveAttribute: "expiresAt",
    });

    this.table.addGlobalSecondaryIndex({
      indexName: DYNAMODB_INDEX_NAMES.operational,
      partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
    });
    this.table.addGlobalSecondaryIndex({
      indexName: DYNAMODB_INDEX_NAMES.relationships,
      partitionKey: { name: "GSI2PK", type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
      sortKey: { name: "GSI2SK", type: AttributeType.STRING },
    });

    for (const [key, value] of Object.entries(requiredTags)) {
      Tags.of(this.table).add(key, value);
    }
    Tags.of(this.table).add("Environment", environmentConfig.name);
  }
}
