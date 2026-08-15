import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CompleteGalleryProcessingInput, FailGalleryProcessingInput, StartGalleryProcessingInput } from "@gym-adr/data-access";
import { GalleryImageWorker, type GalleryObjectStore, type GalleryProcessingRepository } from "./worker";

class FakeRepository implements GalleryProcessingRepository {
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED" = "UPLOADING";
  version = 1;
  failureCode?: string;
  async startProcessing(_input: StartGalleryProcessingInput) {
    if (this.status === "READY") return { disposition: "READY" as const };
    if (this.status === "FAILED") return { disposition: "PERMANENT_FAILURE" as const };
    this.status = "PROCESSING";
    this.version += 1;
    return { disposition: "PROCESS" as const, processingVersion: this.version };
  }
  async completeProcessing(input: CompleteGalleryProcessingInput) { expect(input.expectedVersion).toBe(this.version); this.status = "READY"; this.version += 1; }
  async failProcessing(input: FailGalleryProcessingInput) { expect(input.expectedVersion).toBe(this.version); this.failureCode = input.failureCode; this.status = "FAILED"; this.version += 1; }
}

const event = { bucket: "originals", eTag: "etag", eventTime: "2026-08-14T12:00:00Z", key: "gallery/originals/asset-001.jpg", versionId: "version-1" } as const;

describe("gallery image worker", () => {
  it("retries a transient read and replays READY without rewriting derivatives", async () => {
    const repository = new FakeRepository();
    const body = await sharp({ create: { background: "white", channels: 3, height: 600, width: 900 } }).jpeg().toBuffer();
    let reads = 0;
    const writes: string[] = [];
    const storage: GalleryObjectStore = {
      async getOriginal() { reads += 1; if (reads === 1) throw new Error("temporary"); return { assetId: "asset-001", body, contentType: "image/jpeg" }; },
      async putDerivative(input) { writes.push(input.key); },
    };
    const worker = new GalleryImageWorker(repository, storage);
    await expect(worker.process(event)).rejects.toThrow("temporary");
    await worker.process(event);
    expect(repository.status).toBe("READY");
    expect(writes).toHaveLength(3);
    await worker.process(event);
    expect(writes).toHaveLength(3);
  });

  it("marks corrupted content as a permanent sanitized failure without derivatives", async () => {
    const repository = new FakeRepository();
    const storage: GalleryObjectStore = {
      async getOriginal() { return { assetId: "asset-001", body: Buffer.from("not-an-image"), contentType: "image/jpeg" }; },
      async putDerivative() { throw new Error("must not write"); },
    };
    await new GalleryImageWorker(repository, storage).process(event);
    expect(repository.status).toBe("FAILED");
    expect(repository.failureCode).toBe("INVALID_MIME");
  });
});
