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

export interface GalleryConsentCommand {
  readonly assetId: string;
  readonly grantedBy: string;
  readonly status: "GRANTED" | "REVOKED";
  readonly validUntil?: string;
}

export interface GalleryPublicationCommand {
  readonly consentId?: string;
  readonly expectedVersion: number;
  readonly operation: "HIDE" | "PUBLISH";
  readonly publicObjectKey?: string;
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

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const validateGalleryConsent = (
  value: unknown,
): ValidationResult<GalleryConsentCommand> => {
  if (!isRecord(value)) return { success: false, issues: [issue("$", "El consentimiento debe ser un objeto.")] };
  const issues: ValidationIssue[] = [];
  if (Object.keys(value).some((key) => !["assetId", "grantedBy", "status", "validUntil"].includes(key))) issues.push(issue("$", "El consentimiento incluye campos no permitidos."));
  if (typeof value.assetId !== "string" || !identifier.test(value.assetId)) issues.push(issue("assetId", "El activo no es válido."));
  if (typeof value.grantedBy !== "string" || !identifier.test(value.grantedBy)) issues.push(issue("grantedBy", "La persona no es válida."));
  if (value.status !== "GRANTED" && value.status !== "REVOKED") issues.push(issue("status", "El estado no es válido."));
  if (value.validUntil !== undefined && (typeof value.validUntil !== "string" || !timestamp.test(value.validUntil))) issues.push(issue("validUntil", "La vigencia no es válida."));
  if (issues.length > 0) return { success: false, issues: issues as [ValidationIssue, ...ValidationIssue[]] };
  return { success: true, data: { assetId: value.assetId as string, grantedBy: value.grantedBy as string, status: value.status as "GRANTED" | "REVOKED", ...(value.validUntil === undefined ? {} : { validUntil: value.validUntil as string }) } };
};

export const validateGalleryPublication = (
  value: unknown,
): ValidationResult<GalleryPublicationCommand> => {
  if (!isRecord(value)) return { success: false, issues: [issue("$", "La publicación debe ser un objeto.")] };
  const issues: ValidationIssue[] = [];
  if (Object.keys(value).some((key) => !["consentId", "expectedVersion", "operation", "publicObjectKey"].includes(key))) issues.push(issue("$", "La publicación incluye campos no permitidos."));
  if (value.operation !== "PUBLISH" && value.operation !== "HIDE") issues.push(issue("operation", "La operación no es válida."));
  if (!Number.isSafeInteger(value.expectedVersion) || typeof value.expectedVersion !== "number" || value.expectedVersion < 1) issues.push(issue("expectedVersion", "La versión no es válida."));
  if (value.operation === "PUBLISH") {
    if (typeof value.consentId !== "string" || !identifier.test(value.consentId)) issues.push(issue("consentId", "El consentimiento no es válido."));
    if (typeof value.publicObjectKey !== "string" || !/^gallery\/derived\/[A-Za-z0-9._:-]+\/(?:480|960|1600)\.webp$/u.test(value.publicObjectKey)) issues.push(issue("publicObjectKey", "El derivado público no es válido."));
  } else if (value.consentId !== undefined || value.publicObjectKey !== undefined) issues.push(issue("$", "Ocultar no admite datos de publicación."));
  if (issues.length > 0) return { success: false, issues: issues as [ValidationIssue, ...ValidationIssue[]] };
  return { success: true, data: { expectedVersion: value.expectedVersion as number, operation: value.operation as "HIDE" | "PUBLISH", ...(value.consentId === undefined ? {} : { consentId: value.consentId as string }), ...(value.publicObjectKey === undefined ? {} : { publicObjectKey: value.publicObjectKey as string }) } };
};

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
