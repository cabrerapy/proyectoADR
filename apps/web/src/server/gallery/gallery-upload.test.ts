import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { LocalGalleryUploadSigner, S3GalleryUploadSigner } from "./gallery-upload";

const upload = { contentType: "image/jpeg", fileName: "entrenamiento.jpg", size: 4 } as const;

describe("gallery upload signing", () => {
  it("issues a bounded, one-time local upload", async () => {
    const signer = new LocalGalleryUploadSigner();
    const intent = await signer.issue("asset-1", "gallery/originals/asset-1.jpg", upload);
    const token = intent.uploadUrl.split("/").at(-1) ?? "";
    const request = () => new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2, 3, 4]),
      headers: intent.headers,
      method: "PUT",
    });
    await expect(signer.consumeLocal(token, request())).resolves.toBeUndefined();
    await expect(signer.consumeLocal(token, request())).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a local intent when metadata or size does not match", async () => {
    const signer = new LocalGalleryUploadSigner();
    const intent = await signer.issue("asset-2", "gallery/originals/asset-2.jpg", upload);
    const token = intent.uploadUrl.split("/").at(-1) ?? "";
    await expect(signer.consumeLocal(token, new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { ...intent.headers, "x-amz-meta-assetid": "asset-foreign" },
      method: "PUT",
    }))).rejects.toMatchObject({ status: 422 });
    await expect(signer.consumeLocal(token, new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2]),
      headers: intent.headers,
      method: "PUT",
    }))).rejects.toMatchObject({ status: 422 });
  });

  it("signs a five-minute KMS-encrypted S3 PUT for the exact private key", async () => {
    const client = new S3Client({
      credentials: { accessKeyId: "localplaceholder", secretAccessKey: "localplaceholder" },
      region: "us-east-1",
    });
    try {
      const intent = await new S3GalleryUploadSigner(client, "private-gallery-test")
        .issue("asset-3", "gallery/originals/asset-3.jpg", upload);
      const signed = new URL(intent.uploadUrl);
      expect(signed.hostname).toContain("private-gallery-test");
      expect(signed.pathname).toContain("gallery/originals/asset-3.jpg");
      expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(intent.headers).toMatchObject({
        "content-length": "4",
        "content-type": "image/jpeg",
        "x-amz-meta-assetid": "asset-3",
        "x-amz-server-side-encryption": "aws:kms",
      });
    } finally {
      client.destroy();
    }
  });
});
