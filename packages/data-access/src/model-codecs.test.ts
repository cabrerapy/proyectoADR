import { describe, expect, it } from "vitest";

import { KEY_CODECS, type KeyCodec } from "./model-codecs";
import {
  operationalIndexKeys,
  primaryKeys,
  relationshipIndexKeys,
} from "./model-keys";
import { SHARDS, shardForId } from "./model-shards";
import { ENTITY_TYPES, type EntityType } from "./model-types";
import { asSearchToken, KeyValidationError } from "./model-validation";

const token = asSearchToken("a".repeat(64));

const FIXTURES: Readonly<Record<EntityType, unknown>> = {
  ActiveMembershipPointer: { userId: "user-01" },
  AuditLog: {
    auditId: "audit-01",
    targetId: "user-01",
    targetType: "UserProfile",
    timestamp: "2026-08-05T20:00:00.000Z",
  },
  AuthMapping: { cognitoSub: "cognito-01" },
  ClassSession: { classId: "class-01" },
  ClassType: { classTypeId: "class-type-01" },
  GalleryAsset: { assetId: "asset-01" },
  GymSettings: {},
  Idempotency: {
    dueDate: "2026-08-10",
    membershipId: "membership-01",
    reminderType: "EXPIRY",
  },
  Lookup: { kind: "EMAIL", token, version: "v1" },
  Membership: {
    membershipId: "membership-01",
    startDate: "2026-08-01",
    userId: "user-01",
  },
  MembershipPlan: { planId: "plan-01" },
  Notification: { notificationId: "notification-01" },
  Payment: {
    paidAt: "2026-08-05T20:00:00.000Z",
    paymentId: "payment-01",
    userId: "user-01",
  },
  PaymentCorrection: {
    correctedAt: "2026-08-05T21:00:00.000Z",
    correctionId: "correction-01",
    userId: "user-01",
  },
  PhotoConsent: { consentId: "consent-01" },
  Reservation: { classId: "class-01", studentId: "user-01" },
  Trainer: { trainerId: "trainer-01" },
  UserProfile: { userId: "user-01" },
  View: {
    purpose: "STATUS",
    relatedId: "membership-01",
    targetId: "user-01",
    targetType: "Membership",
  },
};

const KEY_SNAPSHOT = [
  ["UserProfile", { PK: "USER#user-01", SK: "PROFILE" }],
  ["AuthMapping", { PK: "AUTH#COGNITO#cognito-01", SK: "USER" }],
  [
    "Lookup",
    {
      PK: `LOOKUP#EMAIL#v1#${"a".repeat(64)}`,
      SK: "OWNER",
    },
  ],
  ["MembershipPlan", { PK: "PLAN#plan-01", SK: "METADATA" }],
  [
    "Membership",
    {
      PK: "USER#user-01",
      SK: "MEMBERSHIP#2026-08-01#membership-01",
    },
  ],
  [
    "ActiveMembershipPointer",
    { PK: "USER#user-01", SK: "MEMBERSHIP#ACTIVE" },
  ],
  [
    "Payment",
    {
      PK: "USER#user-01",
      SK: "PAYMENT#2026-08-05T20:00:00.000Z#payment-01",
    },
  ],
  [
    "PaymentCorrection",
    {
      PK: "USER#user-01",
      SK: "PAYMENT_CORRECTION#2026-08-05T21:00:00.000Z#correction-01",
    },
  ],
  ["Trainer", { PK: "TRAINER#trainer-01", SK: "METADATA" }],
  ["ClassType", { PK: "CLASS_TYPE#class-type-01", SK: "METADATA" }],
  ["ClassSession", { PK: "CLASS#class-01", SK: "METADATA" }],
  [
    "Reservation",
    { PK: "CLASS#class-01", SK: "RESERVATION#user-01" },
  ],
  ["GalleryAsset", { PK: "GALLERY_ASSET#asset-01", SK: "METADATA" }],
  ["PhotoConsent", { PK: "CONSENT#consent-01", SK: "METADATA" }],
  [
    "Notification",
    { PK: "NOTIFICATION#notification-01", SK: "METADATA" },
  ],
  ["GymSettings", { PK: "SETTINGS", SK: "GYM" }],
  [
    "AuditLog",
    {
      PK: "AUDIT#ENTITY#UserProfile#user-01",
      SK: "AT#2026-08-05T20:00:00.000Z#audit-01",
    },
  ],
  [
    "Idempotency",
    {
      PK: "IDEMPOTENCY#REMINDER#membership-01",
      SK: "REMINDER#EXPIRY#2026-08-10",
    },
  ],
  [
    "View",
    {
      PK: "VIEW#Membership#user-01",
      SK: "VIEW#STATUS#membership-01",
    },
  ],
] as const;

describe("DynamoDB key catalog", () => {
  it("round-trips every entity type and matches the stable key snapshot", () => {
    expect(Object.keys(KEY_CODECS).sort()).toEqual([...ENTITY_TYPES].sort());

    const encoded = ENTITY_TYPES.map((entityType) => {
      const codec = KEY_CODECS[entityType] as unknown as KeyCodec<unknown>;
      const fixture = FIXTURES[entityType];
      const key = codec.encode(fixture);

      expect(codec.decode(key)).toEqual(fixture);
      return [entityType, key] as const;
    });

    expect(encoded).toEqual(KEY_SNAPSHOT);
  });

  it("encodes bounded operational and relationship index keys", () => {
    expect({
      audit: relationshipIndexKeys.auditActor(
        "admin-01",
        "2026-08-05T20:00:00.000Z",
        "audit-01",
      ),
      classDate: operationalIndexKeys.classDate(
        "2026-08-10",
        "S01",
        "AVAILABLE",
        "18:00:00",
        "class-01",
      ),
      due: operationalIndexKeys.membershipDue(
        "2026-08-10",
        "S02",
        "membership-01",
      ),
      reservation: relationshipIndexKeys.reservationByStudent(
        "user-01",
        "2026-08-10T22:00:00.000Z",
        "class-01",
      ),
    }).toEqual({
      audit: {
        PK: "AUDIT_ACTOR#admin-01",
        SK: "AT#2026-08-05T20:00:00.000Z#audit-01",
      },
      classDate: {
        PK: "CLASS_DATE#2026-08-10#S01",
        SK: "AVAILABLE#18:00:00#CLASS#class-01",
      },
      due: {
        PK: "MEMBERSHIP_DUE#2026-08-10#S02",
        SK: "MEMBERSHIP#membership-01",
      },
      reservation: {
        PK: "USER#user-01",
        SK: "RESERVATION#2026-08-10T22:00:00.000Z#CLASS#class-01",
      },
    });
  });

  it("round-trips the sharded name lookup without exposing the name", () => {
    const input = {
      kind: "NAME" as const,
      shard: "S03" as const,
      token,
      userId: "user-01",
      version: "v1",
    };
    const encoded = KEY_CODECS.Lookup.encode(input);

    expect(encoded).toEqual({
      PK: `LOOKUP#NAME#v1#${"a".repeat(64)}#S03`,
      SK: "USER#user-01",
    });
    expect(KEY_CODECS.Lookup.decode(encoded)).toEqual(input);
    expect(JSON.stringify(encoded)).not.toContain("Juan");
  });

  it("uses exactly four stable deterministic shards", () => {
    expect(SHARDS).toEqual(["S00", "S01", "S02", "S03"]);
    expect(shardForId("user-01")).toBe(shardForId("user-01"));
    expect(new Set(["user-01", "user-02", "user-03", "user-04"].map(shardForId)).size).toBeGreaterThan(1);
  });

  it("rejects PII and delimiters instead of placing them in keys", () => {
    expect(() => primaryKeys.userProfile("student@example.com")).toThrow(
      KeyValidationError,
    );
    expect(() => primaryKeys.userProfile("Juan Perez")).toThrow(
      KeyValidationError,
    );
    expect(() => asSearchToken("student@example.com")).toThrow(
      KeyValidationError,
    );
    expect(() => primaryKeys.userProfile("user#other")).toThrow(
      KeyValidationError,
    );
  });

  it("rejects malformed keys during decoding", () => {
    expect(() =>
      KEY_CODECS.UserProfile.decode({ PK: "USER#user-01", SK: "PAYMENT" }),
    ).toThrow("Clave inválida para UserProfile");
  });
});
