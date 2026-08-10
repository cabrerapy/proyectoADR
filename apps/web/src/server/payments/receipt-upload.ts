import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PaymentReceiptUploadCommand } from "@gym-adr/validation";

import { ApiError, apiErrorCodes } from "../http/api-error";

export interface ReceiptUpload {
  readonly headers: Readonly<Record<string, string>>;
  readonly key: string;
  readonly uploadUrl: string;
}

export interface ReceiptUploadPort {
  issue(input: PaymentReceiptUploadCommand): Promise<ReceiptUpload>;
  consumeLocal?(token: string, request: Request): Promise<void>;
}

const extensionByType = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export class S3ReceiptUploadSigner implements ReceiptUploadPort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async issue(input: PaymentReceiptUploadCommand): Promise<ReceiptUpload> {
    const key = `payment-receipts/${randomUUID()}.${extensionByType[input.contentType]}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentLength: input.size,
      ContentType: input.contentType,
      Key: key,
      ServerSideEncryption: "AES256",
    });
    return {
      headers: {
        "content-length": String(input.size),
        "content-type": input.contentType,
        "x-amz-server-side-encryption": "AES256",
      },
      key,
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 300 }),
    };
  }
}

interface LocalIntent {
  readonly contentType: string;
  readonly size: number;
}

export class LocalReceiptUploadSigner implements ReceiptUploadPort {
  private readonly intents = new Map<string, LocalIntent>();

  async issue(input: PaymentReceiptUploadCommand): Promise<ReceiptUpload> {
    const token = randomUUID();
    const key = `payment-receipts/${randomUUID()}.${extensionByType[input.contentType]}`;
    this.intents.set(token, { contentType: input.contentType, size: input.size });
    return {
      headers: { "content-type": input.contentType },
      key,
      uploadUrl: `/api/v1/admin/payment-receipts/local/${token}`,
    };
  }

  async consumeLocal(token: string, request: Request): Promise<void> {
    const intent = this.intents.get(token);
    if (intent === undefined) throw new ApiError(404, apiErrorCodes.notFound, "La carga firmada no existe o expiró.");
    if (request.headers.get("content-type") !== intent.contentType) {
      throw new ApiError(422, apiErrorCodes.validationError, "El tipo del comprobante no coincide con la firma.");
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== intent.size) {
      throw new ApiError(422, apiErrorCodes.validationError, "El tamaño del comprobante no coincide con la firma.");
    }
    this.intents.delete(token);
  }
}
