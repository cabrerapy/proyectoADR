import { createHash } from "node:crypto";
import type { CompleteGalleryProcessingInput, FailGalleryProcessingInput, StartGalleryProcessingInput, StartGalleryProcessingResult } from "@gym-adr/data-access";
import { ImageValidationError, processGalleryImage } from "./image-processor";

export interface GalleryProcessingRepository {
  completeProcessing(input: CompleteGalleryProcessingInput): Promise<void>;
  failProcessing(input: FailGalleryProcessingInput): Promise<void>;
  startProcessing(input: StartGalleryProcessingInput): Promise<StartGalleryProcessingResult>;
}
export interface OriginalImage { readonly assetId?: string; readonly body: Buffer; readonly contentType?: string }
export interface GalleryObjectStore {
  getOriginal(input: { readonly bucket: string; readonly key: string; readonly versionId?: string }): Promise<OriginalImage>;
  putDerivative(input: { readonly body: Buffer; readonly contentType: string; readonly key: string }): Promise<void>;
}
export interface S3ObjectEvent { readonly bucket: string; readonly eTag: string; readonly eventTime: string; readonly key: string; readonly versionId?: string }

const assetFromKey = (key: string): string => {
  const match = /^gallery\/originals\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.(?:jpe?g|png|webp)$/u.exec(key);
  if (match?.[1] === undefined) throw new ImageValidationError("INVALID_OBJECT_KEY");
  return match[1];
};
const sourceIdentity = (event: S3ObjectEvent): string => createHash("sha256").update(event.bucket).update("\0").update(event.key).update("\0").update(event.versionId ?? event.eTag).digest("hex");

export class GalleryImageWorker {
  constructor(private readonly repository: GalleryProcessingRepository, private readonly storage: GalleryObjectStore, private readonly derivativesPrefix = "gallery/derived/") {}

  async process(event: S3ObjectEvent): Promise<void> {
    const key = decodeURIComponent(event.key.replace(/\+/gu, " "));
    const assetId = assetFromKey(key);
    const identity = sourceIdentity({ ...event, key });
    const started = await this.repository.startProcessing({ assetId, originalObjectKey: key, processedAt: event.eventTime, sourceIdentity: identity });
    if (started.disposition !== "PROCESS" || started.processingVersion === undefined) return;
    try {
      const original = await this.storage.getOriginal({ bucket: event.bucket, key, ...(event.versionId === undefined ? {} : { versionId: event.versionId }) });
      if (original.assetId !== assetId) throw new ImageValidationError("ASSET_METADATA_MISMATCH");
      const derivatives = await processGalleryImage(original.body, original.contentType);
      const keys: string[] = [];
      for (const derivative of derivatives) {
        const derivativeKey = `${this.derivativesPrefix}${assetId}/${derivative.width}.webp`;
        await this.storage.putDerivative({ body: derivative.body, contentType: derivative.contentType, key: derivativeKey });
        keys.push(derivativeKey);
      }
      await this.repository.completeProcessing({ assetId, derivativeObjectKeys: keys, expectedVersion: started.processingVersion, processedAt: event.eventTime, sourceIdentity: identity });
    } catch (error) {
      if (error instanceof ImageValidationError) {
        await this.repository.failProcessing({ assetId, expectedVersion: started.processingVersion, failureCode: error.code, processedAt: event.eventTime, sourceIdentity: identity });
        return;
      }
      throw error;
    }
  }
}
