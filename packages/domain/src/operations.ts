import type { EntityId } from "@gym-adr/shared";

export const GALLERY_ASSET_STATUSES = [
  "UPLOADING",
  "PROCESSING",
  "READY",
  "PUBLISHED",
  "HIDDEN",
  "FAILED",
] as const;
export type GalleryAssetStatus = (typeof GALLERY_ASSET_STATUSES)[number];

export interface GalleryAsset {
  readonly consentId?: EntityId;
  readonly createdAt: string;
  readonly createdBy: EntityId;
  readonly id: EntityId;
  readonly originalObjectKey: string;
  readonly publicObjectKey?: string;
  readonly publishedAt?: string;
  readonly status: GalleryAssetStatus;
  readonly updatedAt: string;
  readonly version: number;
}

export const PHOTO_CONSENT_STATUSES = ["GRANTED", "REVOKED"] as const;
export type PhotoConsentStatus = (typeof PHOTO_CONSENT_STATUSES)[number];

export interface PhotoConsent {
  readonly assetId: EntityId;
  readonly createdAt: string;
  readonly grantedBy: EntityId;
  readonly id: EntityId;
  readonly status: PhotoConsentStatus;
  readonly validUntil?: string;
}

export const NOTIFICATION_STATUSES = ["PENDING", "PROCESSING", "SENT", "FAILED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const NOTIFICATION_TYPES = [
  "MEMBERSHIP_EXPIRY",
  "OVERDUE_MEMBERSHIP",
  "RESERVATION_CONFIRMED",
  "CLASS_CANCELLED",
  "CLASS_REMINDER",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  readonly createdAt: string;
  readonly dueDate: string;
  readonly id: EntityId;
  readonly membershipId: EntityId;
  readonly recipientUserId: EntityId;
  readonly scheduledAt: string;
  readonly status: NotificationStatus;
  readonly type: NotificationType;
  readonly updatedAt: string;
  readonly version: number;
}

export interface GymSettings {
  readonly cancellationWindowMinutes: number;
  readonly currency: string;
  readonly gymName: string;
  readonly timezone: string;
  readonly updatedAt: string;
  readonly updatedBy: EntityId;
  readonly version: number;
  readonly whatsappNumber?: string;
}

export const AUDIT_RESULTS = ["SUCCEEDED", "FAILED", "DENIED"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export interface AuditLog {
  readonly action: string;
  readonly actorId: EntityId;
  readonly correlationId: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly id: EntityId;
  readonly result: AuditResult;
  readonly targetId: EntityId;
  readonly targetType: string;
  readonly timestamp: string;
}
