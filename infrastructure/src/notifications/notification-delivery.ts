import { ArnFormat, CfnParameter, Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import type { DynamoDbTable } from "../database/dynamodb-table.js";

export interface NotificationDeliveryProps { readonly dynamoDbTable: DynamoDbTable }

export class NotificationDelivery extends Construct {
  readonly role: Role;
  readonly senderAddress: string;
  constructor(scope: Construct, id: string, props: NotificationDeliveryProps) {
    super(scope, id);
    const sender = new CfnParameter(this, "SenderAddress", { description: "Dirección SES verificada para notificaciones", noEcho: false, type: "String" });
    this.senderAddress = sender.valueAsString;
    this.role = new Role(this, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com"), description: "Entrega recordatorios de Gym ADR con mínimo privilegio" });
    this.role.addToPolicy(new PolicyStatement({ actions: ["dynamodb:BatchGetItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:TransactWriteItems"], effect: Effect.ALLOW, resources: [props.dynamoDbTable.table.tableArn, `${props.dynamoDbTable.table.tableArn}/index/GSI1-Operational`] }));
    this.role.addToPolicy(new PolicyStatement({ actions: ["ses:SendEmail"], effect: Effect.ALLOW, resources: [Stack.of(this).formatArn({ arnFormat: ArnFormat.SLASH_RESOURCE_NAME, resource: "identity", resourceName: sender.valueAsString, service: "ses" })] }));
  }
}
