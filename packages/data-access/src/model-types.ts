export const ENTITY_TYPES = [
  "UserProfile",
  "AuthMapping",
  "Lookup",
  "MembershipPlan",
  "Membership",
  "ActiveMembershipPointer",
  "Payment",
  "PaymentCorrection",
  "Trainer",
  "ClassType",
  "ClassSession",
  "Reservation",
  "GalleryAsset",
  "PhotoConsent",
  "Notification",
  "GymSettings",
  "AuditLog",
  "Idempotency",
  "View",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const CURRENT_SCHEMA_VERSION = 1 as const;

export interface PrimaryKey {
  readonly PK: string;
  readonly SK: string;
}

export interface IndexKey {
  readonly PK: string;
  readonly SK: string;
}

export interface PersistedItemMetadata {
  readonly entityType: EntityType;
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
}
