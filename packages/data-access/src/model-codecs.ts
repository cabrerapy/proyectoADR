import { primaryKeys } from "./model-keys";
import { assertShard, type Shard } from "./model-shards";
import {
  ENTITY_TYPES,
  type EntityType,
  type PrimaryKey,
} from "./model-types";
import { asSearchToken, type SearchToken } from "./model-validation";

export interface KeyInputByEntityType {
  readonly ActiveMembershipPointer: { readonly userId: string };
  readonly AuditLog: {
    readonly auditId: string;
    readonly targetId: string;
    readonly targetType: EntityType;
    readonly timestamp: string;
  };
  readonly AuthMapping: { readonly cognitoSub: string };
  readonly ClassSession: { readonly classId: string };
  readonly ClassType: { readonly classTypeId: string };
  readonly GalleryAsset: { readonly assetId: string };
  readonly GymSettings: Record<string, never>;
  readonly Idempotency:
    | {
        readonly dueDate: string;
        readonly kind: "REMINDER";
        readonly membershipId: string;
        readonly reminderType: string;
      }
    | {
        readonly kind: "REQUEST";
        readonly operation: string;
        readonly requestKey: string;
        readonly subjectId: string;
      };
  readonly Lookup:
    | {
        readonly kind: "EMAIL";
        readonly token: SearchToken;
        readonly version: string;
      }
    | {
        readonly kind: "NAME";
        readonly shard: Shard;
        readonly token: SearchToken;
        readonly userId: string;
        readonly version: string;
      };
  readonly Membership: {
    readonly membershipId: string;
    readonly startDate: string;
    readonly userId: string;
  };
  readonly MembershipPlan: { readonly planId: string };
  readonly Notification: { readonly notificationId: string };
  readonly Payment: {
    readonly paidAt: string;
    readonly paymentId: string;
    readonly userId: string;
  };
  readonly PaymentCorrection: {
    readonly correctedAt: string;
    readonly correctionId: string;
    readonly userId: string;
  };
  readonly PhotoConsent: { readonly consentId: string };
  readonly Reservation: {
    readonly classId: string;
    readonly studentId: string;
  };
  readonly Trainer: { readonly trainerId: string };
  readonly UserProfile: { readonly userId: string };
  readonly View: {
    readonly purpose: string;
    readonly relatedId: string;
    readonly targetId: string;
    readonly targetType: EntityType;
  };
}

export interface KeyCodec<T> {
  readonly decode: (key: PrimaryKey) => T;
  readonly encode: (input: T) => PrimaryKey;
  readonly entityType: EntityType;
}

export class KeyCodecError extends Error {
  public constructor(entityType: EntityType, key: PrimaryKey) {
    super(`Clave inválida para ${entityType}: ${key.PK} / ${key.SK}`);
    this.name = "KeyCodecError";
  }
}

const isEntityType = (value: string): value is EntityType =>
  ENTITY_TYPES.some((entityType) => entityType === value);

const parts = (value: string): readonly string[] => value.split("#");

const required = (
  values: readonly string[],
  index: number,
): string | undefined => {
  const value = values[index];
  return value === "" ? undefined : value;
};

const codec = <T>(
  entityType: EntityType,
  encode: (input: T) => PrimaryKey,
  parse: (key: PrimaryKey) => T | undefined,
): KeyCodec<T> => ({
  decode(key) {
    const decoded = parse(key);
    if (decoded === undefined) {
      throw new KeyCodecError(entityType, key);
    }

    try {
      const canonical = encode(decoded);
      if (canonical.PK !== key.PK || canonical.SK !== key.SK) {
        throw new KeyCodecError(entityType, key);
      }
    } catch {
      throw new KeyCodecError(entityType, key);
    }

    return decoded;
  },
  encode,
  entityType,
});

const metadataCodec = <T extends Record<string, string>>(
  entityType: EntityType,
  partitionPrefix: string,
  property: keyof T,
  encode: (input: T) => PrimaryKey,
): KeyCodec<T> =>
  codec(entityType, encode, (key) => {
    const pk = parts(key.PK);
    const value = required(pk, 1);
    if (pk.length !== 2 || pk[0] !== partitionPrefix || key.SK !== "METADATA" || !value) {
      return undefined;
    }

    return { [property]: value } as T;
  });

export const KEY_CODECS: {
  readonly [K in EntityType]: KeyCodec<KeyInputByEntityType[K]>;
} = {
  ActiveMembershipPointer: codec(
    "ActiveMembershipPointer",
    ({ userId }) => primaryKeys.activeMembership(userId),
    (key) => {
      const pk = parts(key.PK);
      const userId = required(pk, 1);
      return pk.length === 2 && pk[0] === "USER" && key.SK === "MEMBERSHIP#ACTIVE" && userId
        ? { userId }
        : undefined;
    },
  ),
  AuditLog: codec(
    "AuditLog",
    ({ auditId, targetId, targetType, timestamp }) =>
      primaryKeys.auditLog(targetType, targetId, timestamp, auditId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const targetType = required(pk, 2);
      const targetId = required(pk, 3);
      const timestamp = required(sk, 1);
      const auditId = required(sk, 2);
      return pk.length === 4 &&
        pk[0] === "AUDIT" &&
        pk[1] === "ENTITY" &&
        targetType &&
        isEntityType(targetType) &&
        targetId &&
        sk.length === 3 &&
        sk[0] === "AT" &&
        timestamp &&
        auditId
        ? { auditId, targetId, targetType, timestamp }
        : undefined;
    },
  ),
  AuthMapping: codec(
    "AuthMapping",
    ({ cognitoSub }) => primaryKeys.authMapping(cognitoSub),
    (key) => {
      const pk = parts(key.PK);
      const cognitoSub = required(pk, 2);
      return pk.length === 3 && pk[0] === "AUTH" && pk[1] === "COGNITO" && key.SK === "USER" && cognitoSub
        ? { cognitoSub }
        : undefined;
    },
  ),
  ClassSession: metadataCodec(
    "ClassSession",
    "CLASS",
    "classId",
    ({ classId }) => primaryKeys.classSession(classId),
  ),
  ClassType: metadataCodec(
    "ClassType",
    "CLASS_TYPE",
    "classTypeId",
    ({ classTypeId }) => primaryKeys.classType(classTypeId),
  ),
  GalleryAsset: metadataCodec(
    "GalleryAsset",
    "GALLERY_ASSET",
    "assetId",
    ({ assetId }) => primaryKeys.galleryAsset(assetId),
  ),
  GymSettings: codec(
    "GymSettings",
    () => primaryKeys.gymSettings(),
    (key) => key.PK === "SETTINGS" && key.SK === "GYM" ? {} : undefined,
  ),
  Idempotency: codec(
    "Idempotency",
    (input) => input.kind === "REMINDER"
      ? primaryKeys.reminderIdempotency(
          input.membershipId,
          input.reminderType,
          input.dueDate,
        )
      : primaryKeys.idempotency(
          input.operation,
          input.subjectId,
          input.requestKey,
        ),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const operation = required(pk, 1);
      const subjectId = required(pk, 2);
      const requestKey = required(sk, 1);
      if (
        pk.length === 3 &&
        pk[0] === "IDEMPOTENCY" &&
        operation &&
        subjectId &&
        sk.length === 2 &&
        sk[0] === "REQUEST" &&
        requestKey
      ) {
        return {
          kind: "REQUEST",
          operation,
          requestKey,
          subjectId,
        };
      }
      const membershipId = required(pk, 2);
      const reminderType = required(sk, 1);
      const dueDate = required(sk, 2);
      return pk.length === 3 &&
        pk[0] === "IDEMPOTENCY" &&
        pk[1] === "REMINDER" &&
        membershipId &&
        sk.length === 3 &&
        sk[0] === "REMINDER" &&
        reminderType &&
        dueDate
        ? { dueDate, kind: "REMINDER", membershipId, reminderType }
        : undefined;
    },
  ),
  Lookup: codec(
    "Lookup",
    (input) => input.kind === "EMAIL"
      ? primaryKeys.emailLookup(input.version, input.token)
      : primaryKeys.nameLookup(
          input.version,
          input.token,
          input.shard,
          input.userId,
        ),
    (key) => {
      const pk = parts(key.PK);
      if (pk[0] !== "LOOKUP") {
        return undefined;
      }
      if (pk.length === 4 && pk[1] === "EMAIL" && key.SK === "OWNER") {
        const version = required(pk, 2);
        const token = required(pk, 3);
        return version && token
          ? { kind: "EMAIL", token: asSearchToken(token), version }
          : undefined;
      }
      const sk = parts(key.SK);
      const version = required(pk, 2);
      const token = required(pk, 3);
      const shard = required(pk, 4);
      const userId = required(sk, 1);
      return pk.length === 5 &&
        pk[1] === "NAME" &&
        version &&
        token &&
        shard &&
        sk.length === 2 &&
        sk[0] === "USER" &&
        userId
        ? {
            kind: "NAME",
            shard: assertShard(shard),
            token: asSearchToken(token),
            userId,
            version,
          }
        : undefined;
    },
  ),
  Membership: codec(
    "Membership",
    ({ membershipId, startDate, userId }) =>
      primaryKeys.membership(userId, startDate, membershipId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const userId = required(pk, 1);
      const startDate = required(sk, 1);
      const membershipId = required(sk, 2);
      return pk.length === 2 && pk[0] === "USER" && userId && sk.length === 3 && sk[0] === "MEMBERSHIP" && startDate && membershipId
        ? { membershipId, startDate, userId }
        : undefined;
    },
  ),
  MembershipPlan: metadataCodec(
    "MembershipPlan",
    "PLAN",
    "planId",
    ({ planId }) => primaryKeys.membershipPlan(planId),
  ),
  Notification: metadataCodec(
    "Notification",
    "NOTIFICATION",
    "notificationId",
    ({ notificationId }) => primaryKeys.notification(notificationId),
  ),
  Payment: codec(
    "Payment",
    ({ paidAt, paymentId, userId }) => primaryKeys.payment(userId, paidAt, paymentId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const userId = required(pk, 1);
      const paidAt = required(sk, 1);
      const paymentId = required(sk, 2);
      return pk.length === 2 && pk[0] === "USER" && userId && sk.length === 3 && sk[0] === "PAYMENT" && paidAt && paymentId
        ? { paidAt, paymentId, userId }
        : undefined;
    },
  ),
  PaymentCorrection: codec(
    "PaymentCorrection",
    ({ correctedAt, correctionId, userId }) =>
      primaryKeys.paymentCorrection(userId, correctedAt, correctionId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const userId = required(pk, 1);
      const correctedAt = required(sk, 1);
      const correctionId = required(sk, 2);
      return pk.length === 2 && pk[0] === "USER" && userId && sk.length === 3 && sk[0] === "PAYMENT_CORRECTION" && correctedAt && correctionId
        ? { correctedAt, correctionId, userId }
        : undefined;
    },
  ),
  PhotoConsent: metadataCodec(
    "PhotoConsent",
    "CONSENT",
    "consentId",
    ({ consentId }) => primaryKeys.photoConsent(consentId),
  ),
  Reservation: codec(
    "Reservation",
    ({ classId, studentId }) => primaryKeys.reservation(classId, studentId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const classId = required(pk, 1);
      const studentId = required(sk, 1);
      return pk.length === 2 && pk[0] === "CLASS" && classId && sk.length === 2 && sk[0] === "RESERVATION" && studentId
        ? { classId, studentId }
        : undefined;
    },
  ),
  Trainer: metadataCodec(
    "Trainer",
    "TRAINER",
    "trainerId",
    ({ trainerId }) => primaryKeys.trainer(trainerId),
  ),
  UserProfile: codec(
    "UserProfile",
    ({ userId }) => primaryKeys.userProfile(userId),
    (key) => {
      const pk = parts(key.PK);
      const userId = required(pk, 1);
      return pk.length === 2 && pk[0] === "USER" && key.SK === "PROFILE" && userId
        ? { userId }
        : undefined;
    },
  ),
  View: codec(
    "View",
    ({ purpose, relatedId, targetId, targetType }) =>
      primaryKeys.view(targetType, targetId, purpose, relatedId),
    (key) => {
      const pk = parts(key.PK);
      const sk = parts(key.SK);
      const targetType = required(pk, 1);
      const targetId = required(pk, 2);
      const purpose = required(sk, 1);
      const relatedId = required(sk, 2);
      return pk.length === 3 &&
        pk[0] === "VIEW" &&
        targetType &&
        isEntityType(targetType) &&
        targetId &&
        sk.length === 3 &&
        sk[0] === "VIEW" &&
        purpose &&
        relatedId
        ? { purpose, relatedId, targetId, targetType }
        : undefined;
    },
  ),
};
