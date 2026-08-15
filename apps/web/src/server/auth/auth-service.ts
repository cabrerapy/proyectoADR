import { createHash, randomUUID } from "node:crypto";

import {
  DynamoDbRepositoryError,
  type CompletePendingProfileInput,
  type CreateMembershipPlanInput,
  type CreateMembershipInput,
  type CreatePendingUserResult,
  type DynamoDbKey,
  type MembershipFanOutCursors,
  type MembershipPlanCursors,
  type MembershipPlanPage,
  type MembershipPage,
  type PaymentPage,
  type PaymentMutationResult,
  type RecordPaymentInput,
  type CreateSchedulingCatalogInput,
  type CreateClassSessionInput,
  type CancelClassSessionInput,
  type ClassCancellationBatch,
  type BookingMutationResult,
  type CancellationMutationResult,
  type CancelBookingInput,
  type CreateBookingInput,
  type ClassSessionPage,
  type PropagateClassCancellationInput,
  type UpdateClassSessionInput,
  type SchedulingCatalogCursors,
  type SchedulingCatalogPage,
  type UpdateSchedulingCatalogInput,
  type VoidPaymentInput,
  type TransitionUserStatusInput,
  type UpdateMembershipPlanInput,
  type UpdateMembershipInput,
  type UpdateOwnUserProfileInput,
  type UserPage,
} from "@gym-adr/data-access";
import {
  USER_STATUSES,
  MEMBERSHIP_STATUSES,
  AuthorizationDeniedError,
  localCalendarDate,
  membershipStanding,
  type Membership,
  type MembershipPlan,
  type MembershipStanding,
  type Payment,
  type PaymentCorrection,
  type PaymentStatus,
  type ClassType,
  type ClassSession,
  type GymSettings,
  type Trainer,
  type UserProfile,
  type UserStatus,
} from "@gym-adr/domain";
import type {
  AdminStudentQuery,
  CancelClassSessionCommand,
  ClassSessionCommand,
  ClassSessionQuery,
  AdminPaymentQuery,
  CorrectPaymentCommand,
  CreateMembershipCommand,
  CompleteProfileInput,
  MembershipPlanCommand,
  MembershipPlanQuery,
  MembershipHistoryQuery,
  MembershipReportQuery,
  OwnMembershipQuery,
  OwnPaymentQuery,
  PaymentReceiptQuery,
  PaymentReceiptUploadCommand,
  RecordPaymentCommand,
  SchedulingCatalogCommand,
  SchedulingCatalogQuery,
  TransitionStudentStatusInput,
  UpdateMembershipPlanCommand,
  UpdateClassSessionCommand,
  UpdateSchedulingCatalogCommand,
  UpdateMembershipCommand,
  UpdateOwnProfileInput,
} from "@gym-adr/validation";

import { ApiError, apiErrorCodes } from "../http/api-error";
import type { AuthConfig } from "./auth-config";
import { oauthCookieNames, readCookies, serializeCookie, sessionCookieName } from "./cookies";
import type { CognitoTokenPort } from "./cognito-client";
import { createOAuthTransaction, secureEqual } from "./oauth-transaction";
import {
  principalRateKey,
  requestRateKey,
  type RateLimiter,
} from "./rate-limiter";
import {
  AuthorizedRepositoryScope,
  principalFromProfile,
} from "./repository-scope";
import type { ReceiptUpload, ReceiptUploadPort } from "../payments/receipt-upload";

export interface PendingUserPort {
  createPending(input: {
    readonly cognitoSub: string;
    readonly createdAt: string;
    readonly displayName: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly userId: string;
  }): Promise<CreatePendingUserResult>;
  completePendingProfile(input: CompletePendingProfileInput): Promise<UserProfile>;
  findByEmail(email: string): Promise<UserProfile | undefined>;
  findByCognitoSub(cognitoSub: string): Promise<UserProfile | undefined>;
  getById(userId: string, consistentRead?: boolean): Promise<UserProfile | undefined>;
  listByStatus(status: UserStatus, options?: {
    readonly cursors?: NonNullable<UserPage["cursors"]>;
  }): Promise<UserPage>;
  searchByName(prefix: string, options?: {
    readonly cursors?: NonNullable<UserPage["cursors"]>;
  }): Promise<UserPage>;
  transitionStatus(input: TransitionUserStatusInput): Promise<UserProfile>;
  updateOwn(input: UpdateOwnUserProfileInput): Promise<UserProfile>;
}

export interface MembershipPlanPort {
  create(input: CreateMembershipPlanInput): Promise<MembershipPlan>;
  getById(planId: string, consistentRead?: boolean): Promise<MembershipPlan | undefined>;
  list(status?: "ACTIVE" | "INACTIVE" | "ALL", options?: {
    readonly cursors?: MembershipPlanCursors;
  }): Promise<MembershipPlanPage>;
  update(input: UpdateMembershipPlanInput): Promise<MembershipPlan>;
}

export interface MembershipPort {
  create(input: CreateMembershipInput): Promise<Membership>;
  getById(userId: string, startDate: string, membershipId: string, consistentRead?: boolean): Promise<Membership | undefined>;
  getActive(userId: string): Promise<Membership | undefined>;
  listByStatus(status: Membership["status"], options?: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number }): Promise<MembershipPage>;
  listDue(dueDate: string, options?: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number }): Promise<MembershipPage>;
  listHistory(userId: string, options?: { readonly consistentRead?: boolean; readonly cursor?: DynamoDbKey; readonly limit?: number }): Promise<{ readonly memberships: readonly Membership[]; readonly cursor?: DynamoDbKey }>;
  update(input: UpdateMembershipInput): Promise<Membership>;
}

export interface PaymentPort {
  getById(userId: string, paidAt: string, paymentId: string): Promise<Payment | undefined>;
  listByDate(date: string, options?: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number }): Promise<PaymentPage>;
  listByStatus(status: PaymentStatus, options?: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number }): Promise<PaymentPage>;
  listHistory(userId: string, options?: { readonly consistentRead?: boolean; readonly cursor?: DynamoDbKey; readonly limit?: number }): Promise<{ readonly cursor?: DynamoDbKey; readonly payments: readonly Payment[] }>;
  record(input: RecordPaymentInput): Promise<PaymentMutationResult<Payment>>;
  voidConfirmed(input: VoidPaymentInput): Promise<PaymentMutationResult<PaymentCorrection>>;
}

export interface SchedulingCatalogPort {
  createClassType(input: CreateSchedulingCatalogInput): Promise<ClassType>;
  createTrainer(input: CreateSchedulingCatalogInput): Promise<Trainer>;
  getClassType(id: string): Promise<ClassType | undefined>;
  getTrainer(id: string): Promise<Trainer | undefined>;
  listClassTypes(status?: "ACTIVE" | "INACTIVE" | "ALL", cursors?: SchedulingCatalogCursors): Promise<SchedulingCatalogPage<ClassType>>;
  listTrainers(status?: "ACTIVE" | "INACTIVE" | "ALL", cursors?: SchedulingCatalogCursors): Promise<SchedulingCatalogPage<Trainer>>;
  updateClassType(input: UpdateSchedulingCatalogInput): Promise<ClassType>;
  updateTrainer(input: UpdateSchedulingCatalogInput): Promise<Trainer>;
}

export interface ClassSessionPort {
  cancel(input: CancelClassSessionInput): Promise<ClassSession>;
  create(input: CreateClassSessionInput): Promise<ClassSession>;
  getById(id: string, consistentRead?: boolean): Promise<ClassSession | undefined>;
  listByDate(date: string): Promise<ClassSessionPage>;
  propagateCancellationBatch(input: PropagateClassCancellationInput): Promise<ClassCancellationBatch>;
  update(input: UpdateClassSessionInput): Promise<ClassSession>;
}

export interface BookingPort {
  cancel(input: CancelBookingInput): Promise<CancellationMutationResult>;
  reserve(input: CreateBookingInput): Promise<BookingMutationResult>;
}

export interface GymSettingsPort {
  get(): Promise<GymSettings | undefined>;
}

export interface OnboardingProfile {
  readonly completed: boolean;
  readonly displayName: string;
  readonly email: string;
  readonly phone?: string;
  readonly status: UserProfile["status"];
  readonly version: number;
}

export interface OwnProfileView {
  readonly displayName: string;
  readonly email: string;
  readonly emailNotificationsEnabled: boolean;
  readonly joinedAt: string;
  readonly onboardingCompleted: boolean;
  readonly phone?: string;
  readonly roles: UserProfile["roles"];
  readonly status: UserProfile["status"];
  readonly updatedAt: string;
  readonly version: number;
}

export interface AdminStudentView {
  readonly createdAt: string;
  readonly displayName: string;
  readonly email?: string;
  readonly id: string;
  readonly onboardingCompleted: boolean;
  readonly phone?: string;
  readonly roles?: UserProfile["roles"];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AdminStudentPage {
  readonly capabilities: {
    readonly canManageStatus: boolean;
    readonly canReadFull: boolean;
  };
  readonly cursor?: string;
  readonly students: readonly AdminStudentView[];
}

export interface AdminMembershipPlanPage {
  readonly capabilities: { readonly canManage: boolean };
  readonly cursor?: string;
  readonly plans: readonly MembershipPlan[];
}

export interface AdminMembershipView extends Membership {
  readonly standing: MembershipStanding;
}

export interface AdminMembershipPage {
  readonly capabilities: {
    readonly canManageStates: boolean;
    readonly canWrite: boolean;
  };
  readonly memberships: readonly AdminMembershipView[];
}

export interface OwnMembershipPage {
  readonly active?: AdminMembershipView;
  readonly cursor?: string;
  readonly history: readonly AdminMembershipView[];
}

export interface AdminMembershipReportPage {
  readonly cursor?: string;
  readonly memberships: readonly AdminMembershipView[];
}

export type PaymentView = Omit<Payment, "receiptKey"> & { readonly hasReceipt: boolean };
export interface PaymentQueryPage {
  readonly capabilities?: { readonly canCorrect: boolean };
  readonly cursor?: string;
  readonly payments: readonly PaymentView[];
}
export interface SchedulingCatalogViewPage {
  readonly capabilities: { readonly canManage: boolean };
  readonly cursor?: string;
  readonly items: readonly (ClassType | Trainer)[];
}

export interface AuthServiceDependencies {
  readonly bookings?: BookingPort;
  readonly clock?: () => Date;
  readonly config: AuthConfig;
  readonly catalog?: SchedulingCatalogPort;
  readonly classSessions?: ClassSessionPort;
  readonly ids?: () => string;
  readonly settings?: GymSettingsPort;
  readonly memberships?: MembershipPort;
  readonly payments?: PaymentPort;
  readonly plans?: MembershipPlanPort;
  readonly rateLimiter: RateLimiter;
  readonly receipts?: ReceiptUploadPort;
  readonly tokens: CognitoTokenPort;
  readonly users: PendingUserPort;
}

const appendCookie = (headers: Headers, cookie: string): void => headers.append("set-cookie", cookie);
const invalidAuthentication = (message: string): ApiError =>
  new ApiError(400, apiErrorCodes.authenticationInvalid, message);
const authenticationRequired = (): ApiError =>
  new ApiError(401, apiErrorCodes.authenticationRequired, "Tu sesión no es válida o expiró.");

const toOnboardingProfile = (profile: UserProfile): OnboardingProfile => ({
  completed: profile.onboardingCompletedAt !== undefined,
  displayName: profile.displayName,
  email: profile.email,
  ...(profile.phone === undefined ? {} : { phone: profile.phone }),
  status: profile.status,
  version: profile.version,
});

const toOwnProfile = (profile: UserProfile): OwnProfileView => ({
  displayName: profile.displayName,
  email: profile.email,
  emailNotificationsEnabled: profile.emailNotificationsEnabled ?? true,
  joinedAt: profile.createdAt,
  onboardingCompleted: profile.onboardingCompletedAt !== undefined,
  ...(profile.phone === undefined ? {} : { phone: profile.phone }),
  roles: profile.roles,
  status: profile.status,
  updatedAt: profile.updatedAt,
  version: profile.version,
});

type UserCursors = NonNullable<UserPage["cursors"]>;

const toAdminStudent = (profile: UserProfile, full: boolean): AdminStudentView => ({
  createdAt: profile.createdAt,
  displayName: profile.displayName,
  id: profile.id,
  onboardingCompleted: profile.onboardingCompletedAt !== undefined,
  status: profile.status,
  updatedAt: profile.updatedAt,
  version: profile.version,
  ...(full
    ? {
        email: profile.email,
        ...(profile.phone === undefined ? {} : { phone: profile.phone }),
        roles: profile.roles,
      }
    : {}),
});

const queryIdentity = (query: AdminStudentQuery): string =>
  `${query.filter}:${query.value ?? ""}`;

const isCursorKey = (value: unknown): value is Readonly<Record<string, string>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 2 && entries.length <= 4 && entries.every(
    ([key, item]) => ["PK", "SK", "GSI1PK", "GSI1SK"].includes(key) &&
      typeof item === "string" && item.length > 0 && item.length <= 1_024,
  );
};

const decodeCursor = (cursor: string | undefined, query: AdminStudentQuery): UserCursors | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (record.query !== queryIdentity(query) || typeof record.cursors !== "object" || record.cursors === null || Array.isArray(record.cursors)) throw new Error();
    const cursors = record.cursors as Record<string, unknown>;
    const entries = Object.entries(cursors);
    if (entries.length > 8 || !entries.every(([key, value]) => /^(?:S0[0-3]|v\d+:S0[0-3])$/u.test(key) && isCursorKey(value))) throw new Error();
    for (const [cursorKey, value] of entries) {
      const key = value as Readonly<Record<string, string>>;
      if (query.filter === "name") {
        const [version, shard] = cursorKey.split(":");
        if (version === undefined || shard === undefined || !key.PK?.startsWith(`LOOKUP#NAME#${version}#`) || !key.PK.endsWith(`#${shard}`) || !key.SK?.startsWith("USER#")) throw new Error();
      } else {
        const status = query.filter === "pending" ? "PENDING" : query.value;
        if (!key.PK?.startsWith("USER#") || key.SK !== "PROFILE" || key.GSI1PK !== `USER_STATUS#${status}#${cursorKey}` || !key.GSI1SK?.startsWith("CREATED#")) throw new Error();
      }
    }
    return cursors as UserCursors;
  } catch {
    throw new ApiError(422, apiErrorCodes.validationError, "El cursor de paginación no es válido.");
  }
};

const encodeCursor = (query: AdminStudentQuery, cursors: UserPage["cursors"]): string | undefined =>
  cursors === undefined
    ? undefined
    : Buffer.from(JSON.stringify({ cursors, query: queryIdentity(query) }), "utf8").toString("base64url");

const statusFromQuery = (value: string | undefined): UserStatus => {
  const status = USER_STATUSES.find((candidate) => candidate === value);
  if (status !== undefined) return status;
  throw new ApiError(422, apiErrorCodes.validationError, "El estado solicitado no es válido.");
};

const planQueryIdentity = (query: MembershipPlanQuery): string => query.status;

const decodePlanCursor = (cursor: string | undefined, query: MembershipPlanQuery): MembershipPlanCursors | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (record.query !== planQueryIdentity(query) || typeof record.cursors !== "object" || record.cursors === null || Array.isArray(record.cursors)) throw new Error();
    const cursors: Record<string, NonNullable<MembershipPlanCursors[string]> | null> = {};
    for (const [cursorKey, raw] of Object.entries(record.cursors)) {
      if (!/^(ACTIVE|INACTIVE):S0[0-3]$/u.test(cursorKey)) throw new Error();
      if (raw === null) {
        cursors[cursorKey] = null;
        continue;
      }
      if (typeof raw !== "object" || Array.isArray(raw)) throw new Error();
      const key = raw as Record<string, unknown>;
      const [status, shard] = cursorKey.split(":");
      if (typeof key.PK !== "string" || !key.PK.startsWith("PLAN#") || key.SK !== "METADATA" || key.GSI1PK !== `PLAN_STATUS#${status}#${shard}` || typeof key.GSI1SK !== "string" || !key.GSI1SK.startsWith("NAME#")) throw new Error();
      cursors[cursorKey] = key;
    }
    const statuses = query.status === "ALL" ? ["ACTIVE", "INACTIVE"] : [query.status];
    const expectedKeys = statuses.flatMap((status) => ["S00", "S01", "S02", "S03"].map((shard) => `${status}:${shard}`));
    if (Object.keys(cursors).length !== expectedKeys.length || expectedKeys.some((key) => !(key in cursors))) throw new Error();
    return cursors;
  } catch {
    throw new ApiError(422, apiErrorCodes.validationError, "El cursor de paginación no es válido.");
  }
};

const encodePlanCursor = (query: MembershipPlanQuery, cursors: MembershipPlanPage["cursors"]): string | undefined =>
  cursors === undefined ? undefined : Buffer.from(JSON.stringify({ cursors, query: planQueryIdentity(query) }), "utf8").toString("base64url");

const decodeOwnMembershipCursor = (cursor: string | undefined, userId: string): DynamoDbKey | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (record.owner !== userId || !isCursorKey(record.cursor)) throw new Error();
    const key = record.cursor;
    if (Object.keys(key).length !== 2 || key.PK !== `USER#${userId}` || !key.SK?.startsWith("MEMBERSHIP#")) throw new Error();
    return key;
  } catch {
    throw new ApiError(422, apiErrorCodes.validationError, "El cursor de membresías no es válido.");
  }
};

const encodeOwnMembershipCursor = (cursor: DynamoDbKey | undefined, userId: string): string | undefined =>
  cursor === undefined
    ? undefined
    : Buffer.from(JSON.stringify({ cursor, owner: userId }), "utf8").toString("base64url");

const membershipReportIdentity = (query: MembershipReportQuery): string => `${query.filter}:${query.value}`;

const decodeMembershipReportCursor = (
  cursor: string | undefined,
  query: MembershipReportQuery,
): MembershipFanOutCursors | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (record.query !== membershipReportIdentity(query) || typeof record.cursors !== "object" || record.cursors === null || Array.isArray(record.cursors)) throw new Error();
    const rawCursors = record.cursors as Record<string, unknown>;
    const expectedShards = ["S00", "S01", "S02", "S03"];
    if (Object.keys(rawCursors).length !== expectedShards.length || expectedShards.some((shard) => !(shard in rawCursors))) throw new Error();
    const cursors: Record<string, DynamoDbKey | null> = {};
    for (const shard of expectedShards) {
      const raw = rawCursors[shard];
      if (raw === null) {
        cursors[shard] = null;
        continue;
      }
      if (!isCursorKey(raw)) throw new Error();
      const expectedPartition = query.filter === "due"
        ? `MEMBERSHIP_DUE#${query.value}#${shard}`
        : `MEMBERSHIP_STATUS#${query.value}#${shard}`;
      const expectedPurpose = query.filter === "due" ? "VIEW#DUE#" : `VIEW#STATUS_${query.value}#`;
      const validSortKey = query.filter === "due"
        ? raw.GSI1SK?.startsWith("MEMBERSHIP#")
        : raw.GSI1SK?.startsWith("END#") && raw.GSI1SK.includes("#MEMBERSHIP#");
      if (Object.keys(raw).length !== 4 || !raw.PK?.startsWith("VIEW#Membership#") || !raw.SK?.startsWith(expectedPurpose) || raw.GSI1PK !== expectedPartition || !validSortKey) throw new Error();
      cursors[shard] = raw;
    }
    return cursors;
  } catch {
    throw new ApiError(422, apiErrorCodes.validationError, "El cursor del reporte no es válido.");
  }
};

const encodeMembershipReportCursor = (
  query: MembershipReportQuery,
  cursors: MembershipPage["cursors"],
): string | undefined => cursors === undefined
  ? undefined
  : Buffer.from(JSON.stringify({ cursors, query: membershipReportIdentity(query) }), "utf8").toString("base64url");

const paymentView = (payment: Payment): PaymentView => {
  const { receiptKey, ...safe } = payment;
  return { ...safe, hasReceipt: receiptKey !== undefined };
};
const asuncionTime = (value: Date): string => new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Asuncion",
}).format(value);
const decodeOwnPaymentCursor = (cursor: string | undefined, owner: string): DynamoDbKey | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.owner !== owner || !isCursorKey(record.cursor)) throw new Error();
    const key = record.cursor;
    if (Object.keys(key).length !== 2 || key.PK !== `USER#${owner}` || !key.SK?.startsWith("PAYMENT#")) throw new Error();
    return key;
  } catch { throw new ApiError(422, apiErrorCodes.validationError, "El cursor de pagos no es válido."); }
};
const encodeOwnPaymentCursor = (cursor: DynamoDbKey | undefined, owner: string): string | undefined => cursor === undefined
  ? undefined
  : Buffer.from(JSON.stringify({ cursor, owner }), "utf8").toString("base64url");
const paymentQueryIdentity = (query: AdminPaymentQuery): string => `${query.filter}:${query.value}`;
const decodePaymentQueryCursor = (cursor: string | undefined, query: AdminPaymentQuery): MembershipFanOutCursors | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.query !== paymentQueryIdentity(query) || typeof record.cursors !== "object" || record.cursors === null || Array.isArray(record.cursors)) throw new Error();
    const raw = record.cursors as Record<string, unknown>;
    const shards = ["S00", "S01", "S02", "S03"];
    if (Object.keys(raw).length !== shards.length || shards.some((shard) => !(shard in raw))) throw new Error();
    const cursors: Record<string, DynamoDbKey | null> = {};
    for (const shard of shards) {
      const item = raw[shard];
      if (item === null) { cursors[shard] = null; continue; }
      if (!isCursorKey(item) || Object.keys(item).length !== 4) throw new Error();
      const purpose = query.filter === "date" ? "DATE" : `STATUS_${query.value}`;
      const partition = query.filter === "date" ? `PAYMENT_DATE#${query.value}#${shard}` : `PAYMENT_STATUS#${query.value}#${shard}`;
      if (!item.PK?.startsWith("VIEW#Payment#") || !item.SK?.startsWith(`VIEW#${purpose}#`) || item.GSI1PK !== partition || !item.GSI1SK?.startsWith("AT#")) throw new Error();
      cursors[shard] = item;
    }
    return cursors;
  } catch { throw new ApiError(422, apiErrorCodes.validationError, "El cursor de pagos no es válido."); }
};
const encodePaymentQueryCursor = (query: AdminPaymentQuery, cursors: PaymentPage["cursors"]): string | undefined => cursors === undefined
  ? undefined
  : Buffer.from(JSON.stringify({ cursors, query: paymentQueryIdentity(query) }), "utf8").toString("base64url");
const catalogCursorIdentity = (kind: "class-types" | "trainers", query: SchedulingCatalogQuery): string => `${kind}:${query.status}`;
const decodeCatalogCursor = (cursor: string | undefined, kind: "class-types" | "trainers", query: SchedulingCatalogQuery): SchedulingCatalogCursors | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.identity !== catalogCursorIdentity(kind, query) || typeof record.cursors !== "object" || record.cursors === null || Array.isArray(record.cursors)) throw new Error();
    const entries = Object.entries(record.cursors as Record<string, unknown>);
    if (entries.some(([, entry]) => entry !== null && !isCursorKey(entry))) throw new Error();
    return Object.fromEntries(entries) as SchedulingCatalogCursors;
  } catch { throw new ApiError(422, apiErrorCodes.validationError, "El cursor del catálogo no es válido."); }
};
const encodeCatalogCursor = (cursors: SchedulingCatalogCursors | undefined, kind: "class-types" | "trainers", query: SchedulingCatalogQuery): string | undefined => cursors === undefined ? undefined : Buffer.from(JSON.stringify({ cursors, identity: catalogCursorIdentity(kind, query) }), "utf8").toString("base64url");
const classCancellationIdentity = (classId: string, requestKey: string): string =>
  createHash("sha256").update(`${classId}\0${requestKey}`, "utf8").digest("hex");
const decodeClassCancellationCursor = (cursor: string | undefined, classId: string, requestKey: string): DynamoDbKey | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.identity !== classCancellationIdentity(classId, requestKey) || !isCursorKey(record.cursor)) throw new Error();
    const key = record.cursor;
    if (Object.keys(key).length !== 2 || key.PK !== `CLASS#${classId}` || !key.SK?.startsWith("RESERVATION#")) throw new Error();
    return key;
  } catch {
    throw new ApiError(422, apiErrorCodes.validationError, "El cursor de cancelación no es válido.");
  }
};
const encodeClassCancellationCursor = (cursor: DynamoDbKey | undefined, classId: string, requestKey: string): string | undefined => cursor === undefined
  ? undefined
  : Buffer.from(JSON.stringify({ cursor, identity: classCancellationIdentity(classId, requestKey) }), "utf8").toString("base64url");

export class AuthService {
  private readonly clock: () => Date;
  private readonly ids: () => string;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.ids = dependencies.ids ?? randomUUID;
  }

  beginLogin(request: Request): Response {
    this.assertRateLimit(requestRateKey(request, "login"), 10);
    const provider = new URL(request.url).searchParams.get("provider");
    if (provider !== null && provider !== "Google" && provider !== "Facebook") {
      throw invalidAuthentication("Proveedor de acceso no válido.");
    }
    const transaction = createOAuthTransaction();
    const destination = new URL("/oauth2/authorize", this.dependencies.config.hostedUiBaseUrl);
    destination.search = new URLSearchParams({
      client_id: this.dependencies.config.clientId,
      code_challenge: transaction.codeChallenge,
      code_challenge_method: "S256",
      nonce: transaction.nonce,
      redirect_uri: this.dependencies.config.callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state: transaction.state,
      ...(provider === null ? {} : { identity_provider: provider }),
    }).toString();
    const headers = new Headers({ location: destination.toString() });
    const options = { environment: this.dependencies.config.environment, maxAge: 600 } as const;
    appendCookie(headers, serializeCookie(oauthCookieNames.state, transaction.state, options));
    appendCookie(headers, serializeCookie(oauthCookieNames.nonce, transaction.nonce, options));
    appendCookie(headers, serializeCookie(oauthCookieNames.verifier, transaction.codeVerifier, options));
    return new Response(null, { headers, status: 302 });
  }

  async completeCallback(request: Request): Promise<Response> {
    this.assertRateLimit(requestRateKey(request, "callback"), 20);
    const url = new URL(request.url);
    if (url.searchParams.has("error")) {
      throw new ApiError(401, apiErrorCodes.authenticationFailed, "No fue posible iniciar sesión.");
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = readCookies(request.headers.get("cookie"));
    const expectedState = cookies[oauthCookieNames.state];
    const nonce = cookies[oauthCookieNames.nonce];
    const verifier = cookies[oauthCookieNames.verifier];
    const transactionValue = /^[A-Za-z0-9_-]{43}$/u;
    if (
      code === null || code.length < 8 || code.length > 4_096 || state === null ||
      expectedState === undefined || !secureEqual(state, expectedState) ||
      nonce === undefined || verifier === undefined ||
      !transactionValue.test(state) || !transactionValue.test(nonce) ||
      !transactionValue.test(verifier)
    ) throw invalidAuthentication("La solicitud de autenticación expiró o no es válida.");

    let idToken: string;
    let identity: Awaited<ReturnType<CognitoTokenPort["verifyIdToken"]>>;
    try {
      idToken = await this.dependencies.tokens.exchangeCode(code, verifier);
      identity = await this.dependencies.tokens.verifyIdToken(idToken, nonce);
    } catch {
      throw new ApiError(401, apiErrorCodes.authenticationFailed, "No fue posible iniciar sesión.");
    }
    try {
      await this.dependencies.users.createPending({
        ...identity,
        createdAt: this.clock().toISOString(),
        userId: this.ids(),
      });
      const headers = new Headers({
        location: new URL("/onboarding", this.dependencies.config.appBaseUrl).toString(),
      });
      const clear = { environment: this.dependencies.config.environment, maxAge: 0 } as const;
      appendCookie(headers, serializeCookie(oauthCookieNames.state, "", clear));
      appendCookie(headers, serializeCookie(oauthCookieNames.nonce, "", clear));
      appendCookie(headers, serializeCookie(oauthCookieNames.verifier, "", clear));
      appendCookie(headers, serializeCookie(
        sessionCookieName(this.dependencies.config.environment), idToken,
        { environment: this.dependencies.config.environment, maxAge: 900 },
      ));
      return new Response(null, { headers, status: 302 });
    } catch {
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible completar el alta del perfil.");
    }
  }

  async getOnboardingProfile(request: Request): Promise<OnboardingProfile> {
    const profile = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(profile.id, "onboarding-read"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(profile))
        .ownUserId("PROFILE_READ_OWN");
      return toOnboardingProfile(profile);
    } catch (error) {
      this.rethrowAuthorization(error);
      throw error;
    }
  }

  async completeProfile(
    request: Request,
    input: CompleteProfileInput,
  ): Promise<OnboardingProfile> {
    this.assertSameOrigin(request);
    const profile = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(profile.id, "onboarding-write"), 10);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(profile));
      return toOnboardingProfile(await scope.mutateOwn(
        "PROFILE_COMPLETE_ONBOARDING",
        (userId) => this.dependencies.users.completePendingProfile({
          ...input,
          onboardingCompletedAt: this.clock().toISOString(),
          userId,
        }),
      ));
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "USER_STATUS_INVALID") {
          throw new ApiError(403, apiErrorCodes.forbidden, "El estado de tu cuenta cambió.");
        }
        if (
          error.code === "USER_VERSION_CONFLICT" ||
          error.code === "USER_ONBOARDING_COMPLETE"
        ) {
          throw new ApiError(
            409,
            apiErrorCodes.conflict,
            "El perfil cambió. Actualiza la página antes de volver a intentar.",
          );
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible guardar el perfil.");
    }
  }

  async getOwnProfile(request: Request): Promise<OwnProfileView> {
    const profile = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(profile.id, "profile-read"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(profile))
        .ownUserId("PROFILE_READ_OWN");
      return toOwnProfile(profile);
    } catch (error) {
      this.rethrowAuthorization(error);
      throw error;
    }
  }

  async updateOwnProfile(
    request: Request,
    input: UpdateOwnProfileInput,
  ): Promise<OwnProfileView> {
    this.assertSameOrigin(request);
    const profile = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(profile.id, "profile-write"), 20);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(profile));
      return toOwnProfile(await scope.mutateOwn(
        "PROFILE_UPDATE_OWN",
        (userId) => this.dependencies.users.updateOwn({
          ...input,
          updatedAt: this.clock().toISOString(),
          userId,
        }),
      ));
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError) {
        if (
          error.code === "USER_VERSION_CONFLICT" ||
          error.code === "USER_ONBOARDING_INCOMPLETE"
        ) {
          throw new ApiError(
            409,
            apiErrorCodes.conflict,
            "El perfil cambió o todavía no está completo. Actualiza la página.",
          );
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible actualizar el perfil.");
    }
  }

  async listAdminStudents(
    request: Request,
    query: AdminStudentQuery,
  ): Promise<AdminStudentPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "student-list"), 60);
    const full = principal.roles.includes("ADMIN");
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      scope.require(full ? "STUDENT_PROFILE_READ_FULL" : "STUDENT_PROFILE_READ_OPERATIONAL");
      if (query.filter === "email" && !full) scope.require("STUDENT_PROFILE_READ_FULL");
      const cursors = decodeCursor(query.cursor, query);
      let page: UserPage;
      if (query.filter === "email") {
        const profile = await this.dependencies.users.findByEmail(query.value ?? "");
        page = { profiles: profile === undefined ? [] : [profile] };
      } else if (query.filter === "name") {
        page = await this.dependencies.users.searchByName(query.value ?? "", { ...(cursors === undefined ? {} : { cursors }) });
      } else {
        const status = query.filter === "pending" ? "PENDING" : statusFromQuery(query.value);
        page = await this.dependencies.users.listByStatus(status, { ...(cursors === undefined ? {} : { cursors }) });
      }
      const students = page.profiles
        .filter((profile) => profile.roles.includes("STUDENT"))
        .map((profile) => toAdminStudent(profile, full));
      const cursor = encodeCursor(query, page.cursors);
      return {
        capabilities: { canManageStatus: full, canReadFull: full },
        ...(cursor === undefined ? {} : { cursor }),
        students,
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar los alumnos.");
    }
  }

  async getAdminStudent(request: Request, userId: string): Promise<AdminStudentView> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "student-detail"), 60);
    const full = principal.roles.includes("ADMIN");
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal))
        .require(full ? "STUDENT_PROFILE_READ_FULL" : "STUDENT_PROFILE_READ_OPERATIONAL");
      const profile = await this.dependencies.users.getById(userId, true);
      if (profile === undefined || !profile.roles.includes("STUDENT")) {
        throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el alumno solicitado.");
      }
      return toAdminStudent(profile, full);
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar el alumno.");
    }
  }

  async transitionAdminStudent(
    request: Request,
    correlationId: string,
    userId: string,
    input: TransitionStudentStatusInput,
  ): Promise<AdminStudentView> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "student-transition"), 20);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      scope.require("STUDENT_ROLE_STATUS_MANAGE");
      const current = await this.dependencies.users.getById(userId, true);
      if (current === undefined || !current.roles.includes("STUDENT")) {
        throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el alumno solicitado.");
      }
      scope.require(current.status === "PENDING" ? "STUDENT_APPLICATION_REVIEW" : "STUDENT_ROLE_STATUS_MANAGE");
      if (principal.id === userId) throw new AuthorizationDeniedError("NOT_OWNER");
      return toAdminStudent(await this.dependencies.users.transitionStatus({
        ...input,
        actorId: principal.id,
        auditId: this.ids(),
        correlationId,
        transitionedAt: this.clock().toISOString(),
        userId,
      }), true);
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError && ["USER_ONBOARDING_INCOMPLETE", "USER_STATUS_INVALID", "USER_VERSION_CONFLICT"].includes(error.code)) {
        throw new ApiError(409, apiErrorCodes.conflict, "El estado del alumno cambió o la transición no está permitida.");
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible actualizar el estado del alumno.");
    }
  }

  async listAdminMembershipPlans(
    request: Request,
    query: MembershipPlanQuery,
  ): Promise<AdminMembershipPlanPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "plan-list"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PLAN_READ");
      const cursors = decodePlanCursor(query.cursor, query);
      const page = await this.planRepository().list(query.status, {
        ...(cursors === undefined ? {} : { cursors }),
      });
      const cursor = encodePlanCursor(query, page.cursors);
      return {
        capabilities: { canManage: principal.roles.includes("ADMIN") },
        ...(cursor === undefined ? {} : { cursor }),
        plans: page.plans,
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar los planes.");
    }
  }

  async getAdminMembershipPlan(request: Request, planId: string): Promise<MembershipPlan> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "plan-detail"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PLAN_READ");
      const plan = await this.planRepository().getById(planId, true);
      if (plan === undefined) throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el plan solicitado.");
      return plan;
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar el plan.");
    }
  }

  async createAdminMembershipPlan(
    request: Request,
    correlationId: string,
    input: MembershipPlanCommand,
  ): Promise<MembershipPlan> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "plan-write"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PLAN_MANAGE");
      const now = this.clock().toISOString();
      return await this.planRepository().create({
        ...input,
        actorId: principal.id,
        auditId: this.ids(),
        correlationId,
        createdAt: now,
        planId: this.ids(),
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError && error.code === "PLAN_CONFLICT") {
        throw new ApiError(409, apiErrorCodes.conflict, "El plan ya existe o cambió durante la operación.");
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible crear el plan.");
    }
  }

  async updateAdminMembershipPlan(
    request: Request,
    correlationId: string,
    planId: string,
    input: UpdateMembershipPlanCommand,
  ): Promise<MembershipPlan> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "plan-write"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PLAN_MANAGE");
      return await this.planRepository().update({
        ...input,
        actorId: principal.id,
        auditId: this.ids(),
        correlationId,
        planId,
        updatedAt: this.clock().toISOString(),
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") {
          throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el plan solicitado.");
        }
        if (error.code === "PLAN_CONFLICT") {
          throw new ApiError(409, apiErrorCodes.conflict, "El plan cambió. Actualiza la página antes de reintentar.");
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible actualizar el plan.");
    }
  }

  async listAdminSchedulingCatalog(
    request: Request,
    kind: "class-types" | "trainers",
    query: SchedulingCatalogQuery,
  ): Promise<SchedulingCatalogViewPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "scheduling-catalog-read"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("TRAINER_CLASS_TYPE_READ");
      const cursors = decodeCatalogCursor(query.cursor, kind, query);
      const page = kind === "trainers"
        ? await this.catalogRepository().listTrainers(query.status, cursors)
        : await this.catalogRepository().listClassTypes(query.status, cursors);
      const cursor = encodeCatalogCursor(page.cursors, kind, query);
      return {
        capabilities: { canManage: principal.roles.includes("ADMIN") },
        ...(cursor === undefined ? {} : { cursor }),
        items: page.items,
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar el catálogo de clases.");
    }
  }

  async createAdminSchedulingCatalog(
    request: Request,
    correlationId: string,
    kind: "class-types" | "trainers",
    input: SchedulingCatalogCommand,
  ): Promise<ClassType | Trainer> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "scheduling-catalog-write"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("TRAINER_CLASS_TYPE_MANAGE");
      const command = { ...input, actorId: principal.id, auditId: this.ids(), correlationId, createdAt: this.clock().toISOString(), id: this.ids() };
      return kind === "trainers"
        ? await this.catalogRepository().createTrainer(command)
        : await this.catalogRepository().createClassType(command);
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError && error.code === "CATALOG_CONFLICT") throw new ApiError(409, apiErrorCodes.conflict, "El elemento ya existe.");
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible crear el elemento.");
    }
  }

  async updateAdminSchedulingCatalog(
    request: Request,
    correlationId: string,
    kind: "class-types" | "trainers",
    id: string,
    input: UpdateSchedulingCatalogCommand,
  ): Promise<ClassType | Trainer> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "scheduling-catalog-write"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("TRAINER_CLASS_TYPE_MANAGE");
      const command = { ...input, actorId: principal.id, auditId: this.ids(), correlationId, id, updatedAt: this.clock().toISOString() };
      return kind === "trainers"
        ? await this.catalogRepository().updateTrainer(command)
        : await this.catalogRepository().updateClassType(command);
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el elemento.");
        if (error.code === "CATALOG_CONFLICT") throw new ApiError(409, apiErrorCodes.conflict, "El elemento cambió. Actualiza antes de reintentar.");
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible actualizar el elemento.");
    }
  }

  async listAdminClassSessions(request: Request, query: ClassSessionQuery): Promise<{ readonly sessions: readonly ClassSession[] }> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "class-session-read"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("CLASS_SESSION_MANAGE");
      const page = await this.classSessionRepository().listByDate(query.date);
      return { sessions: page.sessions };
    } catch (error) {
      this.rethrowAuthorization(error);
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar las sesiones.");
    }
  }

  async createAdminClassSession(request: Request, correlationId: string, input: ClassSessionCommand): Promise<ClassSession> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "class-session-write"), 30);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("CLASS_SESSION_MANAGE");
      const [trainer, classType] = await Promise.all([this.catalogRepository().getTrainer(input.trainerId), this.catalogRepository().getClassType(input.classTypeId)]);
      if (trainer?.status !== "ACTIVE" || classType?.status !== "ACTIVE") throw new ApiError(422, apiErrorCodes.validationError, "El entrenador y el tipo de clase deben estar activos.");
      const now = this.clock().toISOString();
      const startsAt = new Date(input.startsAt);
      return await this.classSessionRepository().create({
        ...input,
        auditId: this.ids(),
        classDate: localCalendarDate(startsAt),
        classId: this.ids(),
        classTypeName: classType.name,
        correlationId,
        createdAt: now,
        createdBy: principal.id,
        startTime: asuncionTime(startsAt),
        trainerName: trainer.name,
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError && error.code === "CLASS_SESSION_CONFLICT") throw new ApiError(409, apiErrorCodes.conflict, "La sesión ya existe o una referencia cambió.");
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible crear la sesión.");
    }
  }

  async updateAdminClassSession(request: Request, correlationId: string, classId: string, input: UpdateClassSessionCommand): Promise<ClassSession> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "class-session-write"), 30);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("CLASS_SESSION_MANAGE");
      const [trainer, classType] = await Promise.all([this.catalogRepository().getTrainer(input.trainerId), this.catalogRepository().getClassType(input.classTypeId)]);
      if (trainer?.status !== "ACTIVE" || classType?.status !== "ACTIVE") throw new ApiError(422, apiErrorCodes.validationError, "El entrenador y el tipo de clase deben estar activos.");
      const startsAt = new Date(input.startsAt);
      return await this.classSessionRepository().update({
        ...input,
        actorId: principal.id,
        auditId: this.ids(),
        classDate: localCalendarDate(startsAt),
        classId,
        classTypeName: classType.name,
        correlationId,
        startTime: asuncionTime(startsAt),
        trainerName: trainer.name,
        updatedAt: this.clock().toISOString(),
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la sesión.");
        if (error.code === "CLASS_SESSION_CONFLICT") throw new ApiError(409, apiErrorCodes.conflict, "La sesión cambió o la capacidad no admite la edición.");
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible actualizar la sesión.");
    }
  }

  async cancelAdminClassSession(
    request: Request,
    correlationId: string,
    classId: string,
    input: CancelClassSessionCommand,
  ): Promise<{ readonly propagation: { readonly cancelledCount: number; readonly complete: boolean; readonly cursor?: string }; readonly session: ClassSession }> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "class-session-cancel"), 20);
    const requestKey = request.headers.get("idempotency-key");
    if (requestKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)) {
      throw new ApiError(422, apiErrorCodes.validationError, "La clave de idempotencia no es válida.");
    }
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("CLASS_SESSION_MANAGE");
      const cursor = decodeClassCancellationCursor(input.cursor, classId, requestKey);
      const operationHash = createHash("sha256")
        .update(`${principal.id}\0${classId}\0${requestKey}`, "utf8")
        .digest("hex")
        .slice(0, 32);
      const now = this.clock().toISOString();
      await this.classSessionRepository().cancel({
        actorId: principal.id,
        auditId: `audit-cancel-${operationHash}`,
        classId,
        correlationId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        requestKey,
        updatedAt: now,
      });
      const batchHash = createHash("sha256")
        .update(`${operationHash}\0${input.cursor ?? "first"}`, "utf8")
        .digest("hex")
        .slice(0, 32);
      const batch = await this.classSessionRepository().propagateCancellationBatch({
        actorId: principal.id,
        auditId: `audit-cancel-batch-${batchHash}`,
        classId,
        correlationId,
        ...(cursor === undefined ? {} : { cursor }),
        reason: input.reason,
        requestKey,
        updatedAt: now,
      });
      const encodedCursor = encodeClassCancellationCursor(batch.cursor, classId, requestKey);
      return {
        propagation: {
          cancelledCount: batch.cancelledCount,
          complete: batch.complete,
          ...(encodedCursor === undefined ? {} : { cursor: encodedCursor }),
        },
        session: batch.session,
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la sesión.");
        if (error.code === "INVALID_INPUT") throw new ApiError(422, apiErrorCodes.validationError, "Los datos de cancelación no son válidos.");
        if (error.code === "CLASS_SESSION_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "TRANSACTION_CANCELLED" || error.code === "CONDITIONAL_CHECK_FAILED") {
          throw new ApiError(409, apiErrorCodes.conflict, "La sesión cambió o la cancelación ya fue solicitada con datos distintos.");
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible cancelar la sesión.");
    }
  }

  async reserveOwnClass(
    request: Request,
    classId: string,
  ): Promise<BookingMutationResult> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "booking-write"), 20);
    const requestKey = request.headers.get("idempotency-key");
    if (requestKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)) {
      throw new ApiError(422, apiErrorCodes.validationError, "La clave de idempotencia no es válida.");
    }
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      return await scope.mutateOwn("RESERVATION_MANAGE_OWN", async (studentId) => {
        const now = this.clock();
        const membership = await this.membershipRepository().getActive(studentId);
        if (membership === undefined || membershipStanding(membership, now) !== "CURRENT") {
          throw new ApiError(403, apiErrorCodes.forbidden, "Necesitas una membresía activa y vigente para reservar.");
        }
        const today = localCalendarDate(now);
        return this.bookingRepository().reserve({
          classId,
          createdAt: now.toISOString(),
          requestKey,
          reservationId: this.ids(),
          studentId,
          todayEpochDay: Math.floor(Date.parse(`${today}T00:00:00.000Z`) / 86_400_000),
        });
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") {
          throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la sesión.");
        }
        if (
          error.code === "BOOKING_CONFLICT" ||
          error.code === "IDEMPOTENCY_CONFLICT"
        ) {
          throw new ApiError(409, apiErrorCodes.conflict, "La clase ya no admite esta reserva o la solicitud está duplicada.");
        }
        if (error.code === "INVALID_INPUT") {
          throw new ApiError(422, apiErrorCodes.validationError, "La solicitud de reserva no es válida.");
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible confirmar la reserva.");
    }
  }

  async cancelOwnReservation(
    request: Request,
    correlationId: string,
    classId: string,
  ): Promise<CancellationMutationResult> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "booking-cancel"), 20);
    const requestKey = request.headers.get("idempotency-key");
    if (requestKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)) {
      throw new ApiError(422, apiErrorCodes.validationError, "La clave de idempotencia no es válida.");
    }
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      return await scope.mutateOwn("RESERVATION_MANAGE_OWN", async (studentId) => {
        const settings = await this.settingsRepository().get();
        if (settings === undefined) {
          throw new ApiError(500, apiErrorCodes.internalError, "La configuración del gimnasio no está disponible.");
        }
        return this.bookingRepository().cancel({
          actorId: studentId,
          auditId: this.ids(),
          cancellationWindowMinutes: settings.cancellationWindowMinutes,
          cancelledAt: this.clock().toISOString(),
          classId,
          correlationId,
          requestKey,
          settingsVersion: settings.version,
          studentId,
        });
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "RESOURCE_NOT_FOUND") {
          throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la reserva.");
        }
        if (error.code === "BOOKING_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT") {
          throw new ApiError(409, apiErrorCodes.conflict, "La reserva ya no puede cancelarse o la solicitud está duplicada.");
        }
        if (error.code === "INVALID_INPUT") {
          throw new ApiError(422, apiErrorCodes.validationError, "La solicitud de cancelación no es válida.");
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible cancelar la reserva.");
    }
  }

  async listAdminMemberships(
    request: Request,
    query: MembershipHistoryQuery,
  ): Promise<AdminMembershipPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "membership-read"), 60);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("MEMBERSHIP_MANAGE_OPERATIONAL");
      const result = await this.membershipRepository().listHistory(query.userId, {
        consistentRead: true,
        limit: 50,
      });
      return {
        capabilities: {
          canManageStates: principal.roles.includes("ADMIN"),
          canWrite: true,
        },
        memberships: result.memberships.map((membership) => ({
          ...membership,
          standing: membershipStanding(membership, this.clock()),
        })),
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar las membresías.");
    }
  }

  async getOwnMemberships(
    request: Request,
    query: OwnMembershipQuery,
  ): Promise<OwnMembershipPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "own-membership-read"), 60);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      return await scope.listOwn("MEMBERSHIP_READ_OWN", async (userId) => {
        const repository = this.membershipRepository();
        const cursor = decodeOwnMembershipCursor(query.cursor, userId);
        const [active, history] = await Promise.all([
          repository.getActive(userId),
          repository.listHistory(userId, {
            consistentRead: true,
            ...(cursor === undefined ? {} : { cursor }),
            limit: 20,
          }),
        ]);
        const now = this.clock();
        const encodedCursor = encodeOwnMembershipCursor(history.cursor, userId);
        return {
          ...(active === undefined
            ? {}
            : { active: { ...active, standing: membershipStanding(active, now) } }),
          ...(encodedCursor === undefined ? {} : { cursor: encodedCursor }),
          history: history.memberships.map((membership) => ({
            ...membership,
            standing: membershipStanding(membership, now),
          })),
        };
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar tu membresía.");
    }
  }

  async listAdminMembershipReport(
    request: Request,
    query: MembershipReportQuery,
  ): Promise<AdminMembershipReportPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "membership-report"), 30);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("MEMBERSHIP_MANAGE_OPERATIONAL");
      const repository = this.membershipRepository();
      const cursors = decodeMembershipReportCursor(query.cursor, query);
      const page = query.filter === "due"
        ? await repository.listDue(query.value, { ...(cursors === undefined ? {} : { cursors }), limitPerShard: 10 })
        : await repository.listByStatus(this.membershipStatus(query.value), { ...(cursors === undefined ? {} : { cursors }), limitPerShard: 10 });
      const now = this.clock();
      const encodedCursor = encodeMembershipReportCursor(query, page.cursors);
      return {
        ...(encodedCursor === undefined ? {} : { cursor: encodedCursor }),
        memberships: page.memberships.map((membership) => ({
          ...membership,
          standing: membershipStanding(membership, now),
        })),
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar el reporte de membresías.");
    }
  }

  async createAdminMembership(
    request: Request,
    correlationId: string,
    input: CreateMembershipCommand,
  ): Promise<AdminMembershipView> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "membership-write"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("MEMBERSHIP_MANAGE_OPERATIONAL");
      const plan = await this.planRepository().getById(input.planId, true);
      if (plan === undefined || plan.status !== "ACTIVE") {
        throw new ApiError(422, apiErrorCodes.validationError, "Selecciona un plan activo.");
      }
      if (input.expectedAmount !== plan.price) {
        throw new ApiError(422, apiErrorCodes.validationError, "El importe debe coincidir con el precio vigente del plan.");
      }
      const now = this.clock();
      const membership = await this.membershipRepository().create({
        auditId: this.ids(),
        correlationId,
        createdAt: now.toISOString(),
        createdBy: principal.id,
        currency: plan.currency,
        endDate: input.endDate,
        expectedAmount: input.expectedAmount,
        frequency: plan.frequency,
        membershipId: this.ids(),
        planId: plan.id,
        planName: plan.name,
        startDate: input.startDate,
        status: "PENDING",
        userId: input.userId,
      });
      return { ...membership, standing: membershipStanding(membership, now) };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      this.rethrowMembershipPersistence(error, "crear");
    }
  }

  async updateAdminMembership(
    request: Request,
    correlationId: string,
    membershipId: string,
    input: UpdateMembershipCommand,
  ): Promise<AdminMembershipView> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "membership-write"), 20);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      scope.require("MEMBERSHIP_MANAGE_OPERATIONAL");
      const repository = this.membershipRepository();
      const current = await repository.getById(input.userId, input.startDate, membershipId, true);
      if (current === undefined) throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la membresía solicitada.");
      const changesState = current.status !== input.status;
      if (changesState) scope.require("MEMBERSHIP_MANAGE_FULL");
      if (!principal.roles.includes("ADMIN") && current.status !== "PENDING") {
        throw new ApiError(403, apiErrorCodes.forbidden, "El personal solo puede editar membresías pendientes.");
      }
      if ((input.status === "SUSPENDED" || input.status === "CANCELLED") && input.reason === undefined) {
        throw new ApiError(422, apiErrorCodes.validationError, "Indica el motivo del cambio de estado.");
      }
      const now = this.clock();
      if (input.status === "ACTIVE" && localCalendarDate(now) > input.endDate) {
        throw new ApiError(422, apiErrorCodes.validationError, "No se puede activar una membresía cuyo vencimiento ya pasó.");
      }
      if (input.status === "EXPIRED" && localCalendarDate(now) <= current.endDate) {
        throw new ApiError(422, apiErrorCodes.validationError, "La membresía todavía no alcanzó su fecha de vencimiento.");
      }
      const membership = await repository.update({
        actorId: principal.id,
        auditId: this.ids(),
        correlationId,
        endDate: input.endDate,
        expectedAmount: input.expectedAmount,
        expectedVersion: input.expectedVersion,
        membershipId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        startDate: input.startDate,
        status: input.status,
        updatedAt: now.toISOString(),
        userId: input.userId,
      });
      return { ...membership, standing: membershipStanding(membership, now) };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      this.rethrowMembershipPersistence(error, "actualizar");
    }
  }

  async createPaymentReceiptUpload(
    request: Request,
    input: PaymentReceiptUploadCommand,
  ): Promise<ReceiptUpload> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "payment-receipt"), 20);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PAYMENT_RECORD");
      return await this.receiptUploader().issue(input);
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible preparar la carga del comprobante.");
    }
  }

  async consumeLocalPaymentReceipt(token: string, request: Request): Promise<void> {
    const consume = this.receiptUploader().consumeLocal;
    if (consume === undefined) throw new ApiError(404, apiErrorCodes.notFound, "La carga local no está disponible.");
    await consume.call(this.receiptUploader(), token, request);
  }

  async recordAdminPayment(
    request: Request,
    correlationId: string,
    input: RecordPaymentCommand,
  ): Promise<PaymentMutationResult<Payment>> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "payment-write"), 20);
    const requestKey = request.headers.get("idempotency-key");
    if (requestKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)) {
      throw new ApiError(422, apiErrorCodes.validationError, "La clave de idempotencia no es válida.");
    }
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PAYMENT_RECORD");
      const membership = await this.membershipRepository().getById(
        input.userId,
        input.membershipStartDate,
        input.membershipId,
        true,
      );
      if (membership === undefined) throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la membresía indicada.");
      if (input.periodStart < membership.startDate || input.periodEnd > membership.endDate) {
        throw new ApiError(422, apiErrorCodes.validationError, "El periodo pagado debe estar dentro de la membresía.");
      }
      const operationHash = createHash("sha256")
        .update(`${principal.id}\0${requestKey}`, "utf8")
        .digest("hex")
        .slice(0, 32);
      const now = this.clock().toISOString();
      return await this.paymentRepository().record({
        ...input,
        auditId: `audit-${operationHash}`,
        correlationId,
        createdAt: now,
        currency: "PYG",
        paidAt: input.paidAt,
        paymentDate: localCalendarDate(new Date(input.paidAt)),
        paymentId: `payment-${operationHash}`,
        recordedBy: principal.id,
        requestKey,
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError) {
        if (error.code === "IDEMPOTENCY_CONFLICT" || error.code === "PAYMENT_CONFLICT") {
          throw new ApiError(409, apiErrorCodes.conflict, "El pago ya fue registrado con datos distintos o cambió durante la operación.");
        }
        if (error.code === "INVALID_INPUT") {
          throw new ApiError(422, apiErrorCodes.validationError, "Los datos del pago no son válidos.");
        }
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible registrar el pago.");
    }
  }

  async correctAdminPayment(
    request: Request,
    correlationId: string,
    input: CorrectPaymentCommand,
  ): Promise<PaymentMutationResult<Payment | PaymentCorrection>> {
    this.assertSameOrigin(request);
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "payment-correct"), 10);
    const requestKey = request.headers.get("idempotency-key");
    if (requestKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestKey)) {
      throw new ApiError(422, apiErrorCodes.validationError, "La clave de idempotencia no es válida.");
    }
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PAYMENT_CORRECT");
      const original = await this.paymentRepository().getById(input.userId, input.originalPaidAt, input.originalPaymentId);
      if (original === undefined) throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el pago original.");
      const isVoidReplay = input.type === "VOID" && original.status === "VOIDED" && original.version === input.expectedVersion + 1;
      if (!isVoidReplay && (original.status !== "CONFIRMED" || original.version !== input.expectedVersion)) {
        throw new ApiError(409, apiErrorCodes.conflict, "El pago original cambió o ya no está confirmado.");
      }
      const operationHash = createHash("sha256").update(`${principal.id}\0${requestKey}`, "utf8").digest("hex").slice(0, 32);
      const now = this.clock().toISOString();
      if (input.type === "VOID") {
        return await this.paymentRepository().voidConfirmed({
          actorId: principal.id,
          auditId: `audit-${operationHash}`,
          correctedAt: now,
          correctionId: `correction-${operationHash}`,
          correlationId,
          expectedVersion: input.expectedVersion,
          originalPaidAt: input.originalPaidAt,
          paymentId: input.originalPaymentId,
          reason: input.reason,
          requestKey,
          userId: input.userId,
        });
      }
      if (input.amount === undefined) {
        throw new ApiError(422, apiErrorCodes.validationError, "El importe de la corrección es obligatorio.");
      }
      return await this.paymentRepository().record({
        amount: input.amount,
        auditId: `audit-${operationHash}`,
        correlationId,
        correction: {
          expectedOriginalVersion: input.expectedVersion,
          originalPaidAt: input.originalPaidAt,
          originalPaymentId: input.originalPaymentId,
          reason: input.reason,
          type: input.type,
        },
        createdAt: now,
        currency: original.currency,
        membershipId: original.membershipId,
        membershipStartDate: original.periodStart,
        method: "OTHER",
        notes: input.reason,
        paidAt: now,
        paymentDate: localCalendarDate(new Date(now)),
        paymentId: `payment-${operationHash}`,
        periodEnd: original.periodEnd,
        periodStart: original.periodStart,
        recordedBy: principal.id,
        requestKey,
        status: "CONFIRMED",
        userId: original.userId,
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      if (error instanceof DynamoDbRepositoryError && (error.code === "IDEMPOTENCY_CONFLICT" || error.code === "PAYMENT_CONFLICT")) {
        throw new ApiError(409, apiErrorCodes.conflict, "La corrección ya existe con otros datos o el pago cambió.");
      }
      if (error instanceof DynamoDbRepositoryError && error.code === "INVALID_INPUT") {
        throw new ApiError(422, apiErrorCodes.validationError, "Los datos de corrección no son válidos.");
      }
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible corregir el pago.");
    }
  }

  async getOwnPayments(request: Request, query: OwnPaymentQuery): Promise<PaymentQueryPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "own-payment-read"), 60);
    try {
      const scope = new AuthorizedRepositoryScope(principalFromProfile(principal));
      return await scope.listOwn("PAYMENT_READ_OWN", async (userId) => {
        const decodedCursor = decodeOwnPaymentCursor(query.cursor, userId);
        const page = await this.paymentRepository().listHistory(userId, {
          consistentRead: true,
          ...(decodedCursor === undefined ? {} : { cursor: decodedCursor }),
          limit: 20,
        });
        const cursor = encodeOwnPaymentCursor(page.cursor, userId);
        return { ...(cursor === undefined ? {} : { cursor }), payments: page.payments.map(paymentView) };
      });
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar tus pagos.");
    }
  }

  async listAdminPayments(request: Request, query: AdminPaymentQuery): Promise<PaymentQueryPage> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "payment-report"), 30);
    try {
      new AuthorizedRepositoryScope(principalFromProfile(principal)).require("PAYMENT_READ_ALL");
      const cursors = decodePaymentQueryCursor(query.cursor, query);
      const page = query.filter === "date"
        ? await this.paymentRepository().listByDate(query.value, { ...(cursors === undefined ? {} : { cursors }), limitPerShard: 10 })
        : await this.paymentRepository().listByStatus(this.paymentStatus(query.value), { ...(cursors === undefined ? {} : { cursors }), limitPerShard: 10 });
      const cursor = encodePaymentQueryCursor(query, page.cursors);
      return {
        capabilities: { canCorrect: principal.roles.includes("ADMIN") },
        ...(cursor === undefined ? {} : { cursor }),
        payments: page.payments.map(paymentView),
      };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible consultar los pagos.");
    }
  }

  async getOwnPaymentReceipt(request: Request, query: PaymentReceiptQuery): Promise<{ readonly url: string }> {
    const principal = await this.authenticate(request);
    this.assertRateLimit(principalRateKey(principal.id, "payment-receipt-read"), 30);
    try {
      const userId = new AuthorizedRepositoryScope(principalFromProfile(principal)).ownUserId("PAYMENT_READ_OWN");
      const payment = await this.paymentRepository().getById(userId, query.paidAt, query.paymentId);
      if (payment?.receiptKey === undefined) throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el comprobante solicitado.");
      return { url: await this.receiptUploader().issueDownload(payment.receiptKey) };
    } catch (error) {
      this.rethrowAuthorization(error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible abrir el comprobante.");
    }
  }

  async consumeLocalPaymentReceiptDownload(token: string): Promise<Response> {
    const consume = this.receiptUploader().consumeLocalDownload;
    if (consume === undefined) throw new ApiError(404, apiErrorCodes.notFound, "La descarga local no está disponible.");
    return consume.call(this.receiptUploader(), token);
  }

  logout(request: Request): Response {
    this.assertSameOrigin(request);
    this.assertRateLimit(requestRateKey(request, "logout"), 20);
    const destination = new URL("/logout", this.dependencies.config.hostedUiBaseUrl);
    destination.search = new URLSearchParams({
      client_id: this.dependencies.config.clientId,
      logout_uri: this.dependencies.config.appBaseUrl,
    }).toString();
    const headers = new Headers({ location: destination.toString() });
    appendCookie(headers, serializeCookie(
      sessionCookieName(this.dependencies.config.environment),
      "",
      { environment: this.dependencies.config.environment, maxAge: 0 },
    ));
    return new Response(null, { headers, status: 302 });
  }

  private async authenticate(request: Request): Promise<UserProfile> {
    const session = readCookies(request.headers.get("cookie"))[
      sessionCookieName(this.dependencies.config.environment)
    ];
    if (session === undefined || session.length === 0 || session.length > 20_000) {
      throw authenticationRequired();
    }
    let identity: Awaited<ReturnType<CognitoTokenPort["verifySessionToken"]>>;
    try {
      identity = await this.dependencies.tokens.verifySessionToken(session);
    } catch {
      throw authenticationRequired();
    }
    try {
      const profile = await this.dependencies.users.findByCognitoSub(identity.cognitoSub);
      if (profile === undefined) throw authenticationRequired();
      return profile;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, apiErrorCodes.internalError, "No fue posible validar la sesión.");
    }
  }

  private assertSameOrigin(request: Request): void {
    if (request.headers.get("origin") !== this.dependencies.config.appBaseUrl) {
      throw new ApiError(403, apiErrorCodes.forbidden, "El origen de la solicitud no es válido.");
    }
  }

  private assertRateLimit(key: string, limit: number): void {
    if (!this.dependencies.rateLimiter.consume(key, limit, 60_000)) {
      throw new ApiError(
        429,
        apiErrorCodes.rateLimited,
        "Demasiados intentos. Intenta nuevamente en un minuto.",
      );
    }
  }

  private planRepository(): MembershipPlanPort {
    if (this.dependencies.plans === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "El servicio de planes no está configurado.");
    }
    return this.dependencies.plans;
  }

  private catalogRepository(): SchedulingCatalogPort {
    if (this.dependencies.catalog === undefined) throw new ApiError(500, apiErrorCodes.internalError, "El catálogo de clases no está configurado.");
    return this.dependencies.catalog;
  }

  private classSessionRepository(): ClassSessionPort {
    if (this.dependencies.classSessions === undefined) throw new ApiError(500, apiErrorCodes.internalError, "El servicio de sesiones no está configurado.");
    return this.dependencies.classSessions;
  }

  private bookingRepository(): BookingPort {
    if (this.dependencies.bookings === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "El servicio de reservas no está configurado.");
    }
    return this.dependencies.bookings;
  }

  private settingsRepository(): GymSettingsPort {
    if (this.dependencies.settings === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "El servicio de configuración no está configurado.");
    }
    return this.dependencies.settings;
  }

  private membershipRepository(): MembershipPort {
    if (this.dependencies.memberships === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "El servicio de membresías no está configurado.");
    }
    return this.dependencies.memberships;
  }

  private paymentRepository(): PaymentPort {
    if (this.dependencies.payments === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "El servicio de pagos no está configurado.");
    }
    return this.dependencies.payments;
  }

  private receiptUploader(): ReceiptUploadPort {
    if (this.dependencies.receipts === undefined) {
      throw new ApiError(500, apiErrorCodes.internalError, "La carga de comprobantes no está configurada.");
    }
    return this.dependencies.receipts;
  }

  private membershipStatus(value: string): Membership["status"] {
    const status = MEMBERSHIP_STATUSES.find((candidate) => candidate === value);
    if (status === undefined) {
      throw new ApiError(422, apiErrorCodes.validationError, "El estado de membresía no es válido.");
    }
    return status;
  }

  private paymentStatus(value: string): PaymentStatus {
    if (value === "PENDING" || value === "CONFIRMED" || value === "VOIDED") return value;
    throw new ApiError(422, apiErrorCodes.validationError, "El estado de pago no es válido.");
  }

  private rethrowMembershipPersistence(error: unknown, operation: string): never {
    if (error instanceof DynamoDbRepositoryError) {
      if (error.code === "RESOURCE_NOT_FOUND") {
        throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la membresía solicitada.");
      }
      if (error.code === "MEMBERSHIP_CONFLICT") {
        throw new ApiError(409, apiErrorCodes.conflict, "La membresía cambió o existe otra membresía activa. Actualiza antes de reintentar.");
      }
      if (error.code === "INVALID_INPUT") {
        throw new ApiError(422, apiErrorCodes.validationError, "Los datos de la membresía no son válidos.");
      }
    }
    throw new ApiError(502, apiErrorCodes.internalError, `No fue posible ${operation} la membresía.`);
  }

  private rethrowAuthorization(error: unknown): void {
    if (error instanceof AuthorizationDeniedError) {
      throw new ApiError(
        403,
        apiErrorCodes.forbidden,
        "El estado o los permisos de tu cuenta no permiten esta operación.",
      );
    }
  }
}
