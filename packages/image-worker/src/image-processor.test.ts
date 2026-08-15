import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DERIVATIVE_WIDTHS, ImageValidationError, processGalleryImage } from "./image-processor";

describe("gallery image processor", () => {
  it("normalizes orientation, strips metadata and creates watermarked responsive WebP derivatives", async () => {
    const original = await sharp({ create: { background: "#204060", channels: 3, height: 800, width: 1200 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const derivatives = await processGalleryImage(original, "image/jpeg");
    expect(derivatives).toHaveLength(DERIVATIVE_WIDTHS.length);
    expect(derivatives.map(({ contentType }) => contentType)).toEqual(["image/webp", "image/webp", "image/webp"]);
    expect(derivatives[0]).toMatchObject({ height: 480, width: 320 });
    for (const derivative of derivatives) {
      const metadata = await sharp(derivative.body).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(derivative.width).toBeLessThanOrEqual(1600);
      expect(derivative.height).toBeGreaterThan(0);
    }
    const first = derivatives[0];
    if (first === undefined) throw new Error("Falta el derivado esperado.");
    const pixels = await sharp(first.body).raw().toBuffer({ resolveWithObject: true });
    const top = (pixels.data[0] ?? 0) + (pixels.data[1] ?? 0) + (pixels.data[2] ?? 0);
    const markedOffset = ((Math.floor(first.height * 0.95) * first.width) + Math.floor(first.width * 0.85)) * pixels.info.channels;
    const marked = (pixels.data[markedOffset] ?? 0) + (pixels.data[markedOffset + 1] ?? 0) + (pixels.data[markedOffset + 2] ?? 0);
    expect(Math.abs(marked - top)).toBeGreaterThan(30);
  });

  it("rejects MIME spoofing and corrupted content", async () => {
    const jpeg = await sharp({ create: { background: "white", channels: 3, height: 20, width: 20 } }).jpeg().toBuffer();
    await expect(processGalleryImage(jpeg, "image/png")).rejects.toMatchObject({ code: "INVALID_MIME" });
    await expect(processGalleryImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).rejects.toBeInstanceOf(ImageValidationError);
  });
});
