import { randomUUID } from "node:crypto";

import {
  DynamoDbRepositoryError,
  type CompletePendingProfileInput,
  type CreateMembershipPlanInput,
  type CreatePendingUserResult,
  type MembershipPlanCursors,
  type MembershipPlanPage,
  type TransitionUserStatusInput,
  type UpdateMembershipPlanInput,
  type UpdateOwnUserProfileInput,
  type UserPage,
} from "@gym-adr/data-access";
import {
  USER_STATUSES,
  AuthorizationDeniedError,
  type MembershipPlan,
  type UserProfile,
  type UserStatus,
} from "@gym-adr/domain";
import type {
  AdminStudentQuery,
  CompleteProfileInput,
  MembershipPlanCommand,
  MembershipPlanQuery,
  TransitionStudentStatusInput,
  UpdateMembershipPlanCommand,
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

export interface AuthServiceDependencies {
  readonly clock?: () => Date;
  readonly config: AuthConfig;
  readonly ids?: () => string;
  readonly plans?: MembershipPlanPort;
  readonly rateLimiter: RateLimiter;
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
