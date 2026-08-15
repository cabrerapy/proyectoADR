import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { GalleryUploadCommand } from "@gym-adr/validation";

import { ApiError, apiErrorCodes } from "../http/api-error";

export interface GalleryUploadIntent {
  readonly headers: Readonly<Record<string, string>>;
  readonly key: string;
  readonly uploadUrl: string;
}

export interface GalleryUploadSignerPort {
  issue(assetId: string, key: string, input: GalleryUploadCommand): Promise<GalleryUploadIntent>;
  consumeLocal?(token: string, request: Request): Promise<void>;
}

export class S3GalleryUploadSigner implements GalleryUploadSignerPort {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async issue(assetId: string, key: string, input: GalleryUploadCommand): Promise<GalleryUploadIntent> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentLength: input.size,
      ContentType: input.contentType,
      Key: key,
      Metadata: { assetid: assetId },
      ServerSideEncryption: "aws:kms",
    });
    return {
      headers: {
        "content-length": String(input.size),
        "content-type": input.contentType,
        "x-amz-meta-assetid": assetId,
        "x-amz-server-side-encryption": "aws:kms",
      },
      key,
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 300 }),
    };
  }
}

interface LocalGalleryIntent {
  readonly assetId: string;
  readonly contentType: string;
  readonly size: number;
}

export class LocalGalleryUploadSigner implements GalleryUploadSignerPort {
  private readonly intents = new Map<string, LocalGalleryIntent>();

  async issue(assetId: string, key: string, input: GalleryUploadCommand): Promise<GalleryUploadIntent> {
    const token = randomUUID();
    this.intents.set(token, { assetId, contentType: input.contentType, size: input.size });
    return {
      headers: { "content-type": input.contentType, "x-amz-meta-assetid": assetId },
      key,
      uploadUrl: `/api/v1/admin/gallery/uploads/local/${token}`,
    };
  }

  async consumeLocal(token: string, request: Request): Promise<void> {
    const intent = this.intents.get(token);
    if (intent === undefined) throw new ApiError(404, apiErrorCodes.notFound, "La carga firmada no existe o expiró.");
    if (request.headers.get("content-type") !== intent.contentType || request.headers.get("x-amz-meta-assetid") !== intent.assetId) {
      throw new ApiError(422, apiErrorCodes.validationError, "Los metadatos de la imagen no coinciden con la firma.");
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== intent.size) throw new ApiError(422, apiErrorCodes.validationError, "El tamaño de la imagen no coincide con la firma.");
    this.intents.delete(token);
  }
}
