import type { GymSettings } from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { AuditLogRepository } from "./audit-log-repository";
import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem } from "./dynamodb-adapter";
import { invalidDynamoDbInput, mapDynamoDbError } from "./dynamodb-errors";
import { financialCurrency, readFiniteNumber, tableName } from "./financial-validation";
import { primaryKeys } from "./model-keys";
import { CURRENT_SCHEMA_VERSION } from "./model-types";
import { operationId, operationText, operationTimestamp, positiveInteger } from "./operations-validation";

export interface SaveGymSettingsInput {
  readonly auditId: string;
  readonly cancellationWindowMinutes: number;
  readonly correlationId: string;
  readonly currency: string;
  readonly gymName: string;
  readonly timezone: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly whatsappNumber?: string;
}

export class GymSettingsRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;
  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async get(): Promise<GymSettings | undefined> {
    const item = await this.base.get(primaryKeys.gymSettings(), true);
    return item === undefined ? undefined : this.read(item);
  }

  async create(input: SaveGymSettingsInput): Promise<GymSettings> {
    const settings = this.validate(input, 1);
    await this.document.transactWrite({ TransactItems: [
      { Put: { ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)", ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" }, Item: this.item(settings), TableName: this.table } },
      this.auditAction(settings, input, "SETTINGS_CREATED"),
    ] });
    return settings;
  }

  async update(input: SaveGymSettingsInput & { readonly expectedVersion: number }): Promise<GymSettings> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw invalidDynamoDbInput("expectedVersion no es válida.");
    const settings = this.validate(input, input.expectedVersion + 1);
    try {
      await this.document.transactWrite({ TransactItems: [
        { Put: { ConditionExpression: "#entityType = :settings AND #version = :expectedVersion", ExpressionAttributeNames: { "#entityType": "entityType", "#version": "version" }, ExpressionAttributeValues: { ":expectedVersion": input.expectedVersion, ":settings": "GymSettings" }, Item: this.item(settings), TableName: this.table } },
        this.auditAction(settings, input, "SETTINGS_UPDATED"),
      ] });
    } catch (error) { throw mapDynamoDbError(error); }
    return settings;
  }

  private auditAction(settings: GymSettings, input: SaveGymSettingsInput, action: string): NonNullable<TransactWriteCommandInput["TransactItems"]>[number] {
    return new AuditLogRepository(this.document, this.table).createAppendAction({
      action,
      actorId: settings.updatedBy,
      auditId: input.auditId,
      correlationId: input.correlationId,
      details: { cancellationWindowMinutes: settings.cancellationWindowMinutes, currency: settings.currency, version: settings.version },
      result: "SUCCEEDED",
      targetId: "gym",
      targetType: "GymSettings",
      timestamp: settings.updatedAt,
    }).action;
  }

  private validate(input: SaveGymSettingsInput, version: number): GymSettings {
    if (input.timezone !== "America/Asuncion") throw invalidDynamoDbInput("La zona horaria debe ser America/Asuncion para el MVP.");
    const whatsappNumber = input.whatsappNumber === undefined ? undefined : input.whatsappNumber.trim();
    if (whatsappNumber !== undefined && !/^\+[1-9]\d{7,14}$/u.test(whatsappNumber)) throw invalidDynamoDbInput("whatsappNumber debe usar formato E.164.");
    return { cancellationWindowMinutes: positiveInteger(input.cancellationWindowMinutes, "cancellationWindowMinutes", 10_080), currency: financialCurrency(input.currency), gymName: operationText(input.gymName, "gymName", 120), timezone: input.timezone, updatedAt: operationTimestamp(input.updatedAt, "updatedAt"), updatedBy: operationId(input.updatedBy, "updatedBy"), version, ...(whatsappNumber === undefined ? {} : { whatsappNumber }) };
  }

  private item(settings: GymSettings): DynamoDbItem { return { ...primaryKeys.gymSettings(), ...settings, entityType: "GymSettings", schemaVersion: CURRENT_SCHEMA_VERSION }; }
  private read(item: DynamoDbItem): GymSettings {
    const cancellationWindowMinutes = readFiniteNumber(item.cancellationWindowMinutes);
    const version = readFiniteNumber(item.version);
    if (item.entityType !== "GymSettings" || cancellationWindowMinutes === undefined || typeof item.currency !== "string" || typeof item.gymName !== "string" || typeof item.timezone !== "string" || typeof item.updatedAt !== "string" || typeof item.updatedBy !== "string" || version === undefined) throw invalidDynamoDbInput("La configuración persistida no es válida.");
    return { cancellationWindowMinutes, currency: item.currency, gymName: item.gymName, timezone: item.timezone, updatedAt: item.updatedAt, updatedBy: item.updatedBy, version, ...(typeof item.whatsappNumber === "string" ? { whatsappNumber: item.whatsappNumber } : {}) };
  }
}
