import {
  GALLERY_ASSET_STATUSES,
  PHOTO_CONSENT_STATUSES,
  type GalleryAsset,
  type GalleryAssetStatus,
  type PhotoConsent,
  type PhotoConsentStatus,
} from "@gym-adr/domain";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { BaseDynamoDbRepository } from "./base-repository";
import type { DynamoDbDocumentPort, DynamoDbItem, DynamoDbKey } from "./dynamodb-adapter";
import { invalidDynamoDbInput, mapDynamoDbError } from "./dynamodb-errors";
import { readFiniteNumber, tableName } from "./financial-validation";
import { primaryKeys } from "./model-keys";
import { SHARDS, shardForId } from "./model-shards";
import { CURRENT_SCHEMA_VERSION } from "./model-types";
import { objectKey, operationId, operationTimestamp } from "./operations-validation";

type TransactionAction = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export interface CreateGalleryAssetInput {
  readonly assetId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly originalObjectKey: string;
}

export interface CreatePhotoConsentInput {
  readonly assetId: string;
  readonly consentId: string;
  readonly createdAt: string;
  readonly grantedBy: string;
  readonly status: PhotoConsentStatus;
  readonly validUntil?: string;
}

export interface PublishGalleryAssetInput {
  readonly assetId: string;
  readonly consentId: string;
  readonly expectedVersion: number;
  readonly publicObjectKey: string;
  readonly publishedAt: string;
}

export interface PublicGalleryItem {
  readonly assetId: string;
  readonly publicObjectKey: string;
  readonly publishedAt: string;
}

export interface PublicGalleryPage {
  readonly assets: readonly PublicGalleryItem[];
  readonly cursors?: Readonly<Record<string, DynamoDbKey | undefined>>;
}

const isAssetStatus = (value: unknown): value is GalleryAssetStatus =>
  typeof value === "string" && GALLERY_ASSET_STATUSES.some((status) => status === value);
const isConsentStatus = (value: unknown): value is PhotoConsentStatus =>
  typeof value === "string" && PHOTO_CONSENT_STATUSES.some((status) => status === value);
const absent = (table: string, item: DynamoDbItem): TransactionAction => ({
  Put: {
    ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
    ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
    Item: item,
    TableName: table,
  },
});

export class GalleryRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly table: string;

  constructor(private readonly document: DynamoDbDocumentPort, table: string) {
    this.table = tableName(table);
    this.base = new BaseDynamoDbRepository(document, { tableName: table });
  }

  async createAsset(input: CreateGalleryAssetInput): Promise<GalleryAsset> {
    const createdAt = operationTimestamp(input.createdAt, "createdAt");
    const asset: GalleryAsset = {
      createdAt,
      createdBy: operationId(input.createdBy, "createdBy"),
      id: operationId(input.assetId, "assetId"),
      originalObjectKey: objectKey(input.originalObjectKey, "originalObjectKey"),
      status: "UPLOADING",
      updatedAt: createdAt,
      version: 1,
    };
    await this.document.put({
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      Item: this.assetItem(asset),
      TableName: this.table,
    });
    return asset;
  }

  async createConsent(input: CreatePhotoConsentInput): Promise<PhotoConsent> {
    if (!isConsentStatus(input.status)) throw invalidDynamoDbInput("El estado de consentimiento no es válido.");
    const createdAt = operationTimestamp(input.createdAt, "createdAt");
    const validUntil = input.validUntil === undefined ? undefined : operationTimestamp(input.validUntil, "validUntil");
    if (validUntil !== undefined && validUntil < createdAt) throw invalidDynamoDbInput("validUntil no puede ser anterior a createdAt.");
    const consent: PhotoConsent = {
      assetId: operationId(input.assetId, "assetId"),
      createdAt,
      grantedBy: operationId(input.grantedBy, "grantedBy"),
      id: operationId(input.consentId, "consentId"),
      status: input.status,
      ...(validUntil === undefined ? {} : { validUntil }),
    };
    await this.document.put({
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      Item: { ...primaryKeys.photoConsent(consent.id), ...consent, consentId: consent.id, entityType: "PhotoConsent", schemaVersion: CURRENT_SCHEMA_VERSION },
      TableName: this.table,
    });
    return consent;
  }

  async getAsset(assetId: string): Promise<GalleryAsset | undefined> {
    const key = primaryKeys.galleryAsset(operationId(assetId, "assetId"));
    const item = await this.base.get(key, true);
    return item === undefined ? undefined : this.readAsset(item);
  }

  async publish(input: PublishGalleryAssetInput): Promise<GalleryAsset> {
    const assetId = operationId(input.assetId, "assetId");
    const consentId = operationId(input.consentId, "consentId");
    const publicObjectKey = objectKey(input.publicObjectKey, "publicObjectKey");
    const publishedAt = operationTimestamp(input.publishedAt, "publishedAt");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw invalidDynamoDbInput("expectedVersion no es válida.");
    const currentItem = await this.base.get(primaryKeys.galleryAsset(assetId), true);
    if (currentItem === undefined) throw invalidDynamoDbInput("El activo de galería no existe.");
    const current = this.readAsset(currentItem);
    if (current.status !== "READY" || current.version !== input.expectedVersion) throw invalidDynamoDbInput("El activo no está listo o su versión cambió.");
    const next: GalleryAsset = {
      consentId,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
      id: assetId,
      originalObjectKey: current.originalObjectKey,
      publicObjectKey,
      publishedAt,
      status: "PUBLISHED",
      updatedAt: publishedAt,
      version: input.expectedVersion + 1,
    };
    const publicKey = primaryKeys.publishedGalleryAsset(publishedAt.slice(0, 7), shardForId(assetId), publishedAt, assetId);
    const actions: TransactionAction[] = [
      {
        ConditionCheck: {
          ConditionExpression: "#entityType = :consent AND #assetId = :assetId AND #status = :granted AND (attribute_not_exists(#validUntil) OR #validUntil >= :publishedAt)",
          ExpressionAttributeNames: { "#assetId": "assetId", "#entityType": "entityType", "#status": "status", "#validUntil": "validUntil" },
          ExpressionAttributeValues: { ":assetId": assetId, ":consent": "PhotoConsent", ":granted": "GRANTED", ":publishedAt": publishedAt },
          Key: primaryKeys.photoConsent(consentId),
          TableName: this.table,
        },
      },
      {
        Update: {
          ConditionExpression: "#entityType = :asset AND #status = :ready AND #version = :expectedVersion",
          ExpressionAttributeNames: { "#consentId": "consentId", "#entityType": "entityType", "#publicObjectKey": "publicObjectKey", "#publishedAt": "publishedAt", "#status": "status", "#updatedAt": "updatedAt", "#version": "version" },
          ExpressionAttributeValues: { ":asset": "GalleryAsset", ":consentId": consentId, ":expectedVersion": input.expectedVersion, ":nextVersion": input.expectedVersion + 1, ":publicObjectKey": publicObjectKey, ":published": "PUBLISHED", ":publishedAt": publishedAt, ":ready": "READY" },
          Key: primaryKeys.galleryAsset(assetId),
          TableName: this.table,
          UpdateExpression: "SET #status = :published, #consentId = :consentId, #publicObjectKey = :publicObjectKey, #publishedAt = :publishedAt, #updatedAt = :publishedAt, #version = :nextVersion",
        },
      },
      absent(this.table, { ...publicKey, assetId, entityType: "View", publicObjectKey, publishedAt, purpose: "PUBLIC_GALLERY", schemaVersion: CURRENT_SCHEMA_VERSION, targetType: "GalleryAsset" }),
    ];
    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      throw mapDynamoDbError(error);
    }
    return next;
  }

  async listPublic(yearMonth: string, options: { readonly cursors?: Readonly<Record<string, DynamoDbKey | undefined>>; readonly limitPerShard?: number } = {}): Promise<PublicGalleryPage> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(yearMonth)) throw invalidDynamoDbInput("yearMonth no es válido.");
    const limit = options.limitPerShard ?? 25;
    const pages = await Promise.all(SHARDS.map(async (shard) => ({ shard, page: await this.base.queryPage({ ...(options.cursors?.[shard] === undefined ? {} : { cursor: options.cursors[shard] }), limit, partitionValue: `GALLERY#PUBLIC#${yearMonth}#${shard}`, sortKey: { operation: "BEGINS_WITH", value: "PUBLISHED#" } }) })));
    const assets = pages.flatMap(({ page }) => page.items.map((item) => {
      if (item.entityType !== "View" || item.purpose !== "PUBLIC_GALLERY" || typeof item.assetId !== "string" || typeof item.publicObjectKey !== "string" || typeof item.publishedAt !== "string" || "originalObjectKey" in item) throw invalidDynamoDbInput("La vista pública de galería no es válida.");
      return { assetId: item.assetId, publicObjectKey: item.publicObjectKey, publishedAt: item.publishedAt };
    })).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    const cursors = Object.fromEntries(pages.map(({ page, shard }) => [shard, page.nextCursor]));
    return { assets, ...(Object.values(cursors).some(Boolean) ? { cursors } : {}) };
  }

  private assetItem(asset: GalleryAsset): DynamoDbItem {
    return { ...primaryKeys.galleryAsset(asset.id), ...asset, assetId: asset.id, entityType: "GalleryAsset", schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  private readAsset(item: DynamoDbItem): GalleryAsset {
    const version = readFiniteNumber(item.version);
    if (item.entityType !== "GalleryAsset" || typeof item.assetId !== "string" || typeof item.createdAt !== "string" || typeof item.createdBy !== "string" || typeof item.originalObjectKey !== "string" || typeof item.updatedAt !== "string" || version === undefined || !isAssetStatus(item.status)) throw invalidDynamoDbInput("El registro de galería no es válido.");
    return { createdAt: item.createdAt, createdBy: item.createdBy, id: item.assetId, originalObjectKey: item.originalObjectKey, status: item.status, updatedAt: item.updatedAt, version, ...(typeof item.consentId === "string" ? { consentId: item.consentId } : {}), ...(typeof item.publicObjectKey === "string" ? { publicObjectKey: item.publicObjectKey } : {}), ...(typeof item.publishedAt === "string" ? { publishedAt: item.publishedAt } : {}) };
  }
}
