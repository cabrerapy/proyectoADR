import type { ValidationIssue, ValidationResult } from "./index";

export const galleryUploadContentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type GalleryUploadContentType =
  (typeof galleryUploadContentTypes)[number];

export const galleryUploadMaximumBytes = 15 * 1024 * 1024;

export interface GalleryUploadCommand {
  readonly contentType: GalleryUploadContentType;
  readonly fileName: string;
  readonly size: number;
}

const issue = (path: string, message: string): ValidationIssue => ({
  code: "INVALID_GALLERY_UPLOAD_FIELD",
  message,
  path: [path],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isContentType = (value: unknown): value is GalleryUploadContentType =>
  typeof value === "string" &&
  galleryUploadContentTypes.some((candidate) => candidate === value);

export const validateGalleryUpload = (
  value: unknown,
): ValidationResult<GalleryUploadCommand> => {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [issue("$", "La carga debe ser un objeto.")],
    };
  }

  const issues: ValidationIssue[] = [];
  const allowed = new Set(["contentType", "fileName", "size"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    issues.push(issue("$", "La carga incluye campos no permitidos."));
  }
  const contentType = value.contentType;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const size = value.size;
  if (!isContentType(contentType)) {
    issues.push(issue("contentType", "El formato debe ser JPEG, PNG o WebP."));
  }
  if (
    fileName.length < 1 ||
    fileName.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    issues.push(issue("fileName", "El nombre del archivo no es válido."));
  }
  if (
    !Number.isSafeInteger(size) ||
    typeof size !== "number" ||
    size < 1 ||
    size > galleryUploadMaximumBytes
  ) {
    issues.push(issue("size", "La imagen debe pesar entre 1 byte y 15 MB."));
  }
  if (issues.length > 0) {
    return { success: false, issues: issues as [ValidationIssue, ...ValidationIssue[]] };
  }
  return {
    success: true,
    data: {
      contentType: contentType as GalleryUploadContentType,
      fileName,
      size: size as number,
    },
  };
};
