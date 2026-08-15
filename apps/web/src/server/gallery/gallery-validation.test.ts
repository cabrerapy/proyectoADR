import { galleryUploadMaximumBytes, validateGalleryConsent, validateGalleryPublication, validateGalleryUpload } from "@gym-adr/validation";
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

describe("gallery publication validation", () => {
  it("accepts an explicit consent and a bounded derivative key", () => {
    expect(validateGalleryConsent({ assetId: "asset-001", grantedBy: "student-001", status: "GRANTED" })).toMatchObject({ success: true });
    expect(validateGalleryPublication({ consentId: "consent-001", expectedVersion: 4, operation: "PUBLISH", publicObjectKey: "gallery/derived/asset-001/1600.webp" })).toMatchObject({ success: true });
  });

  it("rejects originals, unknown fields and hide payload escalation", () => {
    expect(validateGalleryPublication({ consentId: "consent-001", expectedVersion: 4, operation: "PUBLISH", publicObjectKey: "gallery/originals/private.jpg" })).toMatchObject({ success: false });
    expect(validateGalleryPublication({ expectedVersion: 4, operation: "HIDE", publicObjectKey: "gallery/derived/asset-001/1600.webp" })).toMatchObject({ success: false });
    expect(validateGalleryConsent({ assetId: "asset-001", grantedBy: "student-001", role: "ADMIN", status: "GRANTED" })).toMatchObject({ success: false });
  });
});
