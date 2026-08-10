import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { LocalReceiptUploadSigner, S3ReceiptUploadSigner } from "./receipt-upload";

describe("LocalReceiptUploadSigner", () => {
  it("issues a private one-time upload and validates type and exact size", async () => {
    const signer = new LocalReceiptUploadSigner();
    const intent = await signer.issue({ contentType: "application/pdf", fileName: "recibo.pdf", size: 4 });
    expect(intent.key).toMatch(/^payment-receipts\/[0-9a-f-]+\.pdf$/u);
    const token = intent.uploadUrl.split("/").at(-1) ?? "";
    await expect(signer.consumeLocal(token, new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2, 3, 4]), headers: { "content-type": "application/pdf" }, method: "PUT",
    }))).resolves.toBeUndefined();
    await expect(signer.consumeLocal(token, new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2, 3, 4]), headers: { "content-type": "application/pdf" }, method: "PUT",
    }))).rejects.toMatchObject({ status: 404 });
  });

  it("does not consume an intent when metadata does not match", async () => {
    const signer = new LocalReceiptUploadSigner();
    const intent = await signer.issue({ contentType: "image/png", fileName: "recibo.png", size: 2 });
    const token = intent.uploadUrl.split("/").at(-1) ?? "";
    await expect(signer.consumeLocal(token, new Request("http://localhost/upload", {
      body: new Uint8Array([1, 2]), headers: { "content-type": "image/jpeg" }, method: "PUT",
    }))).rejects.toMatchObject({ status: 422 });
  });

  it("signs a five-minute private S3 PUT with bounded metadata", async () => {
    const client = new S3Client({
      credentials: { accessKeyId: "localplaceholder", secretAccessKey: "localplaceholder" },
      region: "us-east-1",
    });
    try {
      const intent = await new S3ReceiptUploadSigner(client, "private-receipts-test").issue({
        contentType: "image/png", fileName: "recibo.png", size: 3,
      });
      const signed = new URL(intent.uploadUrl);
      expect(signed.hostname).toContain("private-receipts-test");
      expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(intent.headers).toMatchObject({
        "content-length": "3", "content-type": "image/png", "x-amz-server-side-encryption": "AES256",
      });
    } finally {
      client.destroy();
    }
  });
});
