import { galleryUploadMaximumBytes, validateGalleryUpload } from "@gym-adr/validation";
import { describe, expect, it } from "vitest";

describe("gallery upload validation", () => {
  it("accepts a supported image within the bounded size", () => {
    expect(validateGalleryUpload({
      contentType: "image/webp",
      fileName: "clase.webp",
      size: galleryUploadMaximumBytes,
    })).toMatchObject({ success: true });
  });

  it("rejects unsupported media, paths, extra fields and oversized images", () => {
    expect(validateGalleryUpload({ contentType: "image/svg+xml", fileName: "photo.svg", size: 1 })).toMatchObject({ success: false });
    expect(validateGalleryUpload({ contentType: "image/png", fileName: "../photo.png", size: 1 })).toMatchObject({ success: false });
    expect(validateGalleryUpload({ contentType: "image/png", fileName: "photo.png", size: galleryUploadMaximumBytes + 1 })).toMatchObject({ success: false });
    expect(validateGalleryUpload({ contentType: "image/png", fileName: "photo.png", size: 1, userId: "other" })).toMatchObject({ success: false });
  });
});
