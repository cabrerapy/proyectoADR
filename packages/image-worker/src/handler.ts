import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createDynamoDbAdapter, GalleryRepository, type DataEnvironment } from "@gym-adr/data-access";
import { ImageValidationError, MAX_IMAGE_BYTES } from "./image-processor";
import { GalleryImageWorker, type GalleryObjectStore, type OriginalImage, type S3ObjectEvent } from "./worker";

interface SqsRecord { readonly body: string; readonly messageId: string }
interface SqsEvent { readonly Records: readonly SqsRecord[] }
interface S3Notification { readonly Records?: readonly { readonly eventTime?: string; readonly s3?: { readonly bucket?: { readonly name?: string }; readonly object?: { readonly eTag?: string; readonly key?: string; readonly versionId?: string } } }[] }

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length < 1) throw new Error(`Falta configuración requerida: ${name}.`);
  return value;
};

const limitedBody = async (body: unknown, declaredLength: number | undefined): Promise<Buffer> => {
  if (declaredLength !== undefined && declaredLength > MAX_IMAGE_BYTES) throw new ImageValidationError("INVALID_SIZE");
  if (typeof body !== "object" || body === null || !(Symbol.asyncIterator in body)) throw new Error("El cuerpo S3 no está disponible.");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_IMAGE_BYTES) throw new ImageValidationError("INVALID_SIZE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
};

export class S3GalleryObjectStore implements GalleryObjectStore {
  constructor(private readonly client: S3Client, private readonly derivativesBucket: string) {}
  async getOriginal(input: { readonly bucket: string; readonly key: string; readonly versionId?: string }): Promise<OriginalImage> {
    const output = await this.client.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key, ...(input.versionId === undefined ? {} : { VersionId: input.versionId }) }));
    const assetId = output.Metadata?.assetid;
    const contentType = output.ContentType;
    return {
      body: await limitedBody(output.Body, output.ContentLength),
      ...(assetId === undefined ? {} : { assetId }),
      ...(contentType === undefined ? {} : { contentType }),
    };
  }
  async putDerivative(input: { readonly body: Buffer; readonly contentType: string; readonly key: string }): Promise<void> {
    await this.client.send(new PutObjectCommand({ Body: input.body, Bucket: this.derivativesBucket, CacheControl: "public,max-age=31536000,immutable", ContentType: input.contentType, Key: input.key, ServerSideEncryption: "aws:kms" }));
  }
}

const parseNotifications = (body: string, expectedBucket: string): readonly S3ObjectEvent[] => {
  let notification: S3Notification;
  try { notification = JSON.parse(body) as S3Notification; } catch { throw new Error("El mensaje SQS no es válido."); }
  if (!Array.isArray(notification.Records) || notification.Records.length < 1) throw new Error("El mensaje S3 está vacío.");
  return notification.Records.map((record) => {
    const bucket = record.s3?.bucket?.name;
    const eTag = record.s3?.object?.eTag;
    const eventTime = record.eventTime;
    const key = record.s3?.object?.key;
    if (bucket !== expectedBucket || typeof eTag !== "string" || typeof eventTime !== "string" || !Number.isFinite(Date.parse(eventTime)) || typeof key !== "string") throw new Error("El evento S3 no es válido.");
    const versionId = record.s3?.object?.versionId;
    return { bucket, eTag, eventTime, key, ...(versionId === undefined ? {} : { versionId }) };
  });
};

const environment = requiredEnvironment("APP_ENVIRONMENT") as DataEnvironment;
const region = requiredEnvironment("AWS_REGION");
const originalsBucket = requiredEnvironment("GALLERY_ORIGINALS_BUCKET_NAME");
const derivativesBucket = requiredEnvironment("GALLERY_DERIVATIVES_BUCKET_NAME");
const document = createDynamoDbAdapter({ environment, region });
const worker = new GalleryImageWorker(new GalleryRepository(document, requiredEnvironment("DYNAMODB_TABLE_NAME")), new S3GalleryObjectStore(new S3Client({ region }), derivativesBucket));

export const handler = async (event: SqsEvent): Promise<{ readonly batchItemFailures: readonly { readonly itemIdentifier: string }[] }> => {
  const failures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      for (const notification of parseNotifications(record.body, originalsBucket)) await worker.process(notification);
    } catch { failures.push({ itemIdentifier: record.messageId }); }
  }
  return { batchItemFailures: failures };
};
