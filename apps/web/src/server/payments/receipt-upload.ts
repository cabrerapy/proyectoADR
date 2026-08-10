import { randomUUID } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  issueDownload(key: string): Promise<string>;
  consumeLocal?(token: string, request: Request): Promise<void>;
  consumeLocalDownload?(token: string): Promise<Response>;
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

  async issueDownload(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 300 });
  }
}

interface LocalIntent {
  readonly contentType: string;
  readonly key: string;
  readonly size: number;
}

interface LocalObject { readonly body: ArrayBuffer; readonly contentType: string }

export class LocalReceiptUploadSigner implements ReceiptUploadPort {
  private readonly intents = new Map<string, LocalIntent>();
  private readonly objects = new Map<string, LocalObject>();
  private readonly downloads = new Map<string, string>();

  async issue(input: PaymentReceiptUploadCommand): Promise<ReceiptUpload> {
    const token = randomUUID();
    const key = `payment-receipts/${randomUUID()}.${extensionByType[input.contentType]}`;
    this.intents.set(token, { contentType: input.contentType, key, size: input.size });
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
    this.objects.set(intent.key, { body, contentType: intent.contentType });
    this.intents.delete(token);
  }

  async issueDownload(key: string): Promise<string> {
    if (!this.objects.has(key)) throw new ApiError(404, apiErrorCodes.notFound, "El comprobante no está disponible.");
    const token = randomUUID();
    this.downloads.set(token, key);
    return `/api/v1/payment-receipts/local/${token}`;
  }

  async consumeLocalDownload(token: string): Promise<Response> {
    const key = this.downloads.get(token);
    const object = key === undefined ? undefined : this.objects.get(key);
    if (object === undefined) throw new ApiError(404, apiErrorCodes.notFound, "El enlace firmado no existe o expiró.");
    this.downloads.delete(token);
    return new Response(object.body.slice(0), {
      headers: { "cache-control": "private, no-store", "content-type": object.contentType },
    });
  }
}
