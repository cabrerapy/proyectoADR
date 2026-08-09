import type { Shard } from "./model-shards";
import type { EntityType, IndexKey, PrimaryKey } from "./model-types";
import {
  assertDate,
  assertOpaqueSegment,
  assertTime,
  assertTimestamp,
  assertTokenVersion,
  assertYearMonth,
  type SearchToken,
} from "./model-validation";

const key = (PK: string, SK: string): PrimaryKey => ({ PK, SK });
const indexKey = (PK: string, SK: string): IndexKey => ({ PK, SK });
const id = (value: string, label: string): string =>
  assertOpaqueSegment(value, label);

export const primaryKeys = {
  activeMembership: (userId: string): PrimaryKey =>
    key(`USER#${id(userId, "userId")}`, "MEMBERSHIP#ACTIVE"),
  auditLog: (
    targetType: EntityType,
    targetId: string,
    timestamp: string,
    auditId: string,
  ): PrimaryKey =>
    key(
      `AUDIT#ENTITY#${targetType}#${id(targetId, "targetId")}`,
      `AT#${assertTimestamp(timestamp)}#${id(auditId, "auditId")}`,
    ),
  authMapping: (cognitoSub: string): PrimaryKey =>
    key(`AUTH#COGNITO#${id(cognitoSub, "cognitoSub")}`, "USER"),
  classSession: (classId: string): PrimaryKey =>
    key(`CLASS#${id(classId, "classId")}`, "METADATA"),
  classType: (classTypeId: string): PrimaryKey =>
    key(`CLASS_TYPE#${id(classTypeId, "classTypeId")}`, "METADATA"),
  emailLookup: (
    version: string,
    token: SearchToken,
  ): PrimaryKey =>
    key(`LOOKUP#EMAIL#${assertTokenVersion(version)}#${token}`, "OWNER"),
  galleryAsset: (assetId: string): PrimaryKey =>
    key(`GALLERY_ASSET#${id(assetId, "assetId")}`, "METADATA"),
  gymSettings: (): PrimaryKey => key("SETTINGS", "GYM"),
  idempotency: (
    operation: string,
    subjectId: string,
    requestKey: string,
  ): PrimaryKey =>
    key(
      `IDEMPOTENCY#${id(operation, "operation")}#${id(subjectId, "subjectId")}`,
      `REQUEST#${id(requestKey, "requestKey")}`,
    ),
  membership: (
    userId: string,
    startDate: string,
    membershipId: string,
  ): PrimaryKey =>
    key(
      `USER#${id(userId, "userId")}`,
      `MEMBERSHIP#${assertDate(startDate, "startDate")}#${id(membershipId, "membershipId")}`,
    ),
  membershipPlan: (planId: string): PrimaryKey =>
    key(`PLAN#${id(planId, "planId")}`, "METADATA"),
  nameLookup: (
    version: string,
    prefixToken: SearchToken,
    shard: Shard,
    userId: string,
  ): PrimaryKey =>
    key(
      `LOOKUP#NAME#${assertTokenVersion(version)}#${prefixToken}#${shard}`,
      `USER#${id(userId, "userId")}`,
    ),
  notification: (notificationId: string): PrimaryKey =>
    key(`NOTIFICATION#${id(notificationId, "notificationId")}`, "METADATA"),
  payment: (
    userId: string,
    paidAt: string,
    paymentId: string,
  ): PrimaryKey =>
    key(
      `USER#${id(userId, "userId")}`,
      `PAYMENT#${assertTimestamp(paidAt, "paidAt")}#${id(paymentId, "paymentId")}`,
    ),
  paymentCorrection: (
    userId: string,
    correctedAt: string,
    correctionId: string,
  ): PrimaryKey =>
    key(
      `USER#${id(userId, "userId")}`,
      `PAYMENT_CORRECTION#${assertTimestamp(correctedAt, "correctedAt")}#${id(correctionId, "correctionId")}`,
    ),
  photoConsent: (consentId: string): PrimaryKey =>
    key(`CONSENT#${id(consentId, "consentId")}`, "METADATA"),
  publishedGalleryAsset: (
    yearMonth: string,
    shard: Shard,
    publishedAt: string,
    assetId: string,
  ): PrimaryKey =>
    key(
      `GALLERY#PUBLIC#${assertYearMonth(yearMonth)}#${shard}`,
      `PUBLISHED#${assertTimestamp(publishedAt, "publishedAt")}#${id(assetId, "assetId")}`,
    ),
  reminderIdempotency: (
    membershipId: string,
    reminderType: string,
    dueDate: string,
  ): PrimaryKey =>
    key(
      `IDEMPOTENCY#REMINDER#${id(membershipId, "membershipId")}`,
      `REMINDER#${id(reminderType, "reminderType")}#${assertDate(dueDate, "dueDate")}`,
    ),
  reservation: (classId: string, studentId: string): PrimaryKey =>
    key(
      `CLASS#${id(classId, "classId")}`,
      `RESERVATION#${id(studentId, "studentId")}`,
    ),
  trainer: (trainerId: string): PrimaryKey =>
    key(`TRAINER#${id(trainerId, "trainerId")}`, "METADATA"),
  userProfile: (userId: string): PrimaryKey =>
    key(`USER#${id(userId, "userId")}`, "PROFILE"),
  view: (
    targetType: EntityType,
    targetId: string,
    purpose: string,
    relatedId: string,
  ): PrimaryKey =>
    key(
      `VIEW#${targetType}#${id(targetId, "targetId")}`,
      `VIEW#${id(purpose, "purpose")}#${id(relatedId, "relatedId")}`,
    ),
} as const;

export const operationalIndexKeys = {
  classDate: (
    date: string,
    shard: Shard,
    availability: "AVAILABLE" | "FULL",
    startTime: string,
    classId: string,
  ): IndexKey =>
    indexKey(
      `CLASS_DATE#${assertDate(date)}#${shard}`,
      `${availability}#${assertTime(startTime, "startTime")}#CLASS#${id(classId, "classId")}`,
    ),
  membershipDue: (
    dueDate: string,
    shard: Shard,
    membershipId: string,
  ): IndexKey =>
    indexKey(
      `MEMBERSHIP_DUE#${assertDate(dueDate, "dueDate")}#${shard}`,
      `MEMBERSHIP#${id(membershipId, "membershipId")}`,
    ),
  membershipStatus: (
    status: string,
    shard: Shard,
    endDate: string,
    membershipId: string,
  ): IndexKey =>
    indexKey(
      `MEMBERSHIP_STATUS#${id(status, "status")}#${shard}`,
      `END#${assertDate(endDate, "endDate")}#MEMBERSHIP#${id(membershipId, "membershipId")}`,
    ),
  notificationPending: (
    scheduledDate: string,
    shard: Shard,
    scheduledAt: string,
    notificationId: string,
  ): IndexKey =>
    indexKey(
      `NOTIFICATION#PENDING#${assertDate(scheduledDate, "scheduledDate")}#${shard}`,
      `AT#${assertTimestamp(scheduledAt, "scheduledAt")}#NOTIFICATION#${id(notificationId, "notificationId")}`,
    ),
  paymentDate: (
    date: string,
    shard: Shard,
    paidAt: string,
    paymentId: string,
  ): IndexKey =>
    indexKey(
      `PAYMENT_DATE#${assertDate(date)}#${shard}`,
      `AT#${assertTimestamp(paidAt, "paidAt")}#PAYMENT#${id(paymentId, "paymentId")}`,
    ),
  paymentStatus: (
    status: string,
    shard: Shard,
    paidAt: string,
    paymentId: string,
  ): IndexKey =>
    indexKey(
      `PAYMENT_STATUS#${id(status, "status")}#${shard}`,
      `AT#${assertTimestamp(paidAt, "paidAt")}#PAYMENT#${id(paymentId, "paymentId")}`,
    ),
  planStatus: (
    status: string,
    shard: Shard,
    normalizedName: string,
    planId: string,
  ): IndexKey =>
    indexKey(
      `PLAN_STATUS#${id(status, "status")}#${shard}`,
      `NAME#${id(normalizedName, "normalizedName")}#PLAN#${id(planId, "planId")}`,
    ),
  userStatus: (
    status: string,
    shard: Shard,
    createdAt: string,
    userId: string,
  ): IndexKey =>
    indexKey(
      `USER_STATUS#${id(status, "status")}#${shard}`,
      `CREATED#${assertTimestamp(createdAt, "createdAt")}#USER#${id(userId, "userId")}`,
    ),
} as const;

export const relationshipIndexKeys = {
  auditActor: (
    actorId: string,
    timestamp: string,
    auditId: string,
  ): IndexKey =>
    indexKey(
      `AUDIT_ACTOR#${id(actorId, "actorId")}`,
      `AT#${assertTimestamp(timestamp)}#${id(auditId, "auditId")}`,
    ),
  reservationByStudent: (
    studentId: string,
    startsAt: string,
    classId: string,
  ): IndexKey =>
    indexKey(
      `USER#${id(studentId, "studentId")}`,
      `RESERVATION#${assertTimestamp(startsAt, "startsAt")}#CLASS#${id(classId, "classId")}`,
    ),
  sessionsByTrainer: (
    trainerId: string,
    startsAt: string,
    classId: string,
  ): IndexKey =>
    indexKey(
      `TRAINER#${id(trainerId, "trainerId")}`,
      `START#${assertTimestamp(startsAt, "startsAt")}#CLASS#${id(classId, "classId")}`,
    ),
} as const;
