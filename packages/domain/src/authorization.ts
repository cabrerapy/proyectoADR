import type { EntityId } from "@gym-adr/shared";

import {
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from "./user";

export const AUTHORIZATION_ACTIONS = [
  "PUBLIC_CONTENT_READ",
  "PUBLIC_CONTENT_MANAGE",
  "PROFILE_READ_OWN",
  "PROFILE_UPDATE_OWN",
  "PROFILE_COMPLETE_ONBOARDING",
  "STUDENT_PROFILE_READ_OPERATIONAL",
  "STUDENT_PROFILE_READ_FULL",
  "STUDENT_APPLICATION_REVIEW",
  "STUDENT_ROLE_STATUS_MANAGE",
  "PLAN_READ",
  "PLAN_MANAGE",
  "MEMBERSHIP_READ_OWN",
  "MEMBERSHIP_MANAGE_OPERATIONAL",
  "MEMBERSHIP_MANAGE_FULL",
  "PAYMENT_READ_OWN",
  "PAYMENT_READ_ALL",
  "PAYMENT_RECORD",
  "PAYMENT_CORRECT",
  "CLASS_SESSION_READ",
  "CLASS_SESSION_MANAGE",
  "RESERVATION_MANAGE_OWN",
  "RESERVATION_CANCEL_OTHERS",
  "TRAINER_CLASS_TYPE_READ",
  "TRAINER_CLASS_TYPE_MANAGE",
  "GALLERY_UPLOAD_HIDE",
  "GALLERY_PUBLISH_CONSENT",
  "SETTINGS_MANAGE",
  "AUDIT_READ",
  "ROLE_PERMISSION_MANAGE",
] as const;

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

export const ROLE_PERMISSIONS = {
  STUDENT: [
    "PUBLIC_CONTENT_READ",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
    "PROFILE_COMPLETE_ONBOARDING",
    "MEMBERSHIP_READ_OWN",
    "PAYMENT_READ_OWN",
    "CLASS_SESSION_READ",
    "RESERVATION_MANAGE_OWN",
  ],
  STAFF: [
    "PUBLIC_CONTENT_READ",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
    "STUDENT_PROFILE_READ_OPERATIONAL",
    "PLAN_READ",
    "MEMBERSHIP_READ_OWN",
    "MEMBERSHIP_MANAGE_OPERATIONAL",
    "PAYMENT_READ_OWN",
    "PAYMENT_READ_ALL",
    "PAYMENT_RECORD",
    "CLASS_SESSION_READ",
    "CLASS_SESSION_MANAGE",
    "RESERVATION_MANAGE_OWN",
    "RESERVATION_CANCEL_OTHERS",
    "TRAINER_CLASS_TYPE_READ",
    "GALLERY_UPLOAD_HIDE",
  ],
  ADMIN: [
    "PUBLIC_CONTENT_READ",
    "PUBLIC_CONTENT_MANAGE",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
    "STUDENT_PROFILE_READ_OPERATIONAL",
    "STUDENT_PROFILE_READ_FULL",
    "STUDENT_APPLICATION_REVIEW",
    "STUDENT_ROLE_STATUS_MANAGE",
    "PLAN_READ",
    "PLAN_MANAGE",
    "MEMBERSHIP_READ_OWN",
    "MEMBERSHIP_MANAGE_OPERATIONAL",
    "MEMBERSHIP_MANAGE_FULL",
    "PAYMENT_READ_OWN",
    "PAYMENT_READ_ALL",
    "PAYMENT_RECORD",
    "PAYMENT_CORRECT",
    "CLASS_SESSION_READ",
    "CLASS_SESSION_MANAGE",
    "RESERVATION_MANAGE_OWN",
    "RESERVATION_CANCEL_OTHERS",
    "TRAINER_CLASS_TYPE_READ",
    "TRAINER_CLASS_TYPE_MANAGE",
    "GALLERY_UPLOAD_HIDE",
    "GALLERY_PUBLISH_CONSENT",
    "SETTINGS_MANAGE",
    "AUDIT_READ",
    "ROLE_PERMISSION_MANAGE",
  ],
} as const satisfies Readonly<Record<UserRole, readonly AuthorizationAction[]>>;

const STATUS_PERMISSIONS = {
  PENDING: [
    "PUBLIC_CONTENT_READ",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
    "PROFILE_COMPLETE_ONBOARDING",
  ],
  ACTIVE: AUTHORIZATION_ACTIONS.filter(
    (action) => action !== "PROFILE_COMPLETE_ONBOARDING",
  ),
  SUSPENDED: [
    "PUBLIC_CONTENT_READ",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
  ],
  REJECTED: ["PUBLIC_CONTENT_READ", "PROFILE_READ_OWN"],
  INACTIVE: [
    "PUBLIC_CONTENT_READ",
    "PROFILE_READ_OWN",
    "PROFILE_UPDATE_OWN",
  ],
} as const satisfies Readonly<Record<UserStatus, readonly AuthorizationAction[]>>;

const OWNED_ACTIONS: ReadonlySet<AuthorizationAction> = new Set([
  "PROFILE_READ_OWN",
  "PROFILE_UPDATE_OWN",
  "PROFILE_COMPLETE_ONBOARDING",
  "MEMBERSHIP_READ_OWN",
  "PAYMENT_READ_OWN",
  "RESERVATION_MANAGE_OWN",
]);

export interface AuthorizationPrincipal {
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly userId: EntityId;
}

export interface AuthorizationResource {
  readonly ownerId?: EntityId;
}

export interface AuthorizationRequest {
  readonly action: string;
  readonly principal?: AuthorizationPrincipal;
  readonly resource?: AuthorizationResource;
}

export type AuthorizationDenialReason =
  | "UNAUTHENTICATED"
  | "INVALID_PRINCIPAL"
  | "UNKNOWN_ACTION"
  | "STATUS_DENIED"
  | "ROLE_DENIED"
  | "OWNERSHIP_REQUIRED"
  | "NOT_OWNER";

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AuthorizationDenialReason };

const includes = <T extends string>(values: readonly T[], value: string): value is T =>
  values.some((candidate) => candidate === value);

const isValidPrincipal = (
  principal: AuthorizationPrincipal,
): boolean =>
  principal.userId.trim().length > 0 &&
  includes(USER_STATUSES, principal.status) &&
  principal.roles.length > 0 &&
  principal.roles.every((role) => includes(USER_ROLES, role));

export const authorize = (request: AuthorizationRequest): AuthorizationDecision => {
  if (!includes(AUTHORIZATION_ACTIONS, request.action)) {
    return { allowed: false, reason: "UNKNOWN_ACTION" };
  }
  if (request.principal === undefined) {
    return { allowed: false, reason: "UNAUTHENTICATED" };
  }
  if (!isValidPrincipal(request.principal)) {
    return { allowed: false, reason: "INVALID_PRINCIPAL" };
  }

  const { action, principal } = request;
  if (!includes(STATUS_PERMISSIONS[principal.status], action)) {
    return { allowed: false, reason: "STATUS_DENIED" };
  }
  if (!principal.roles.some((role) => includes(ROLE_PERMISSIONS[role], action))) {
    return { allowed: false, reason: "ROLE_DENIED" };
  }
  if (OWNED_ACTIONS.has(action)) {
    const ownerId = request.resource?.ownerId;
    if (ownerId === undefined || ownerId.length === 0) {
      return { allowed: false, reason: "OWNERSHIP_REQUIRED" };
    }
    if (ownerId !== principal.userId) {
      return { allowed: false, reason: "NOT_OWNER" };
    }
  }

  return { allowed: true };
};

export class AuthorizationDeniedError extends Error {
  readonly code = "AUTHORIZATION_DENIED";

  constructor(readonly reason: AuthorizationDenialReason) {
    super("La operación no está autorizada.");
    this.name = "AuthorizationDeniedError";
  }
}

export const requireAuthorization = (request: AuthorizationRequest): void => {
  const decision = authorize(request);
  if (!decision.allowed) {
    throw new AuthorizationDeniedError(decision.reason);
  }
};
