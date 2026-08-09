import { describe, expect, it } from "vitest";

import {
  AUTHORIZATION_ACTIONS,
  AuthorizationDeniedError,
  ROLE_PERMISSIONS,
  authorize,
  requireAuthorization,
  type AuthorizationAction,
  type AuthorizationPrincipal,
} from "./authorization";

const principal = (
  roles: AuthorizationPrincipal["roles"],
  status: AuthorizationPrincipal["status"] = "ACTIVE",
): AuthorizationPrincipal => ({ roles, status, userId: "user-1" });

const decisionFor = (
  role: AuthorizationPrincipal["roles"][number],
  action: AuthorizationAction,
) => authorize({
  action,
  principal: principal([role]),
  resource: { ownerId: "user-1" },
});

describe("authorization matrix", () => {
  it.each(["STUDENT", "STAFF", "ADMIN"] as const)(
    "matches every explicit ACTIVE permission for %s",
    (role) => {
      for (const action of AUTHORIZATION_ACTIONS) {
        const expected = action !== "PROFILE_COMPLETE_ONBOARDING" &&
          ROLE_PERMISSIONS[role].some((permission) => permission === action);
        expect(decisionFor(role, action).allowed, action).toBe(expected);
      }
    },
  );

  it("grants pending students only public and own onboarding capabilities", () => {
    const pending = principal(["STUDENT"], "PENDING");
    for (const action of AUTHORIZATION_ACTIONS) {
      const decision = authorize({
        action,
        principal: pending,
        resource: { ownerId: pending.userId },
      });
      expect(decision.allowed, action).toBe([
        "PUBLIC_CONTENT_READ",
        "PROFILE_READ_OWN",
        "PROFILE_UPDATE_OWN",
        "PROFILE_COMPLETE_ONBOARDING",
      ].includes(action));
    }
  });

  it.each([
    ["SUSPENDED", ["PUBLIC_CONTENT_READ", "PROFILE_READ_OWN", "PROFILE_UPDATE_OWN"]],
    ["INACTIVE", ["PUBLIC_CONTENT_READ", "PROFILE_READ_OWN", "PROFILE_UPDATE_OWN"]],
    ["REJECTED", ["PUBLIC_CONTENT_READ", "PROFILE_READ_OWN"]],
  ] as const)("limits %s users independently of role", (status, permitted) => {
    const inactiveAdmin = principal(["ADMIN"], status);
    for (const action of AUTHORIZATION_ACTIONS) {
      expect(authorize({
        action,
        principal: inactiveAdmin,
        resource: { ownerId: inactiveAdmin.userId },
      }).allowed, action).toBe(
        permitted.some((permission) => permission === action),
      );
    }
  });

  it("denies horizontal access to every owned capability", () => {
    const ownActions = [
      "PROFILE_READ_OWN",
      "PROFILE_UPDATE_OWN",
      "MEMBERSHIP_READ_OWN",
      "PAYMENT_READ_OWN",
      "RESERVATION_MANAGE_OWN",
    ] as const;
    for (const action of ownActions) {
      expect(authorize({
        action,
        principal: principal(["STUDENT"]),
        resource: { ownerId: "user-2" },
      })).toEqual({ allowed: false, reason: "NOT_OWNER" });
    }
  });

  it("denies student and staff privilege escalation", () => {
    expect(decisionFor("STUDENT", "PAYMENT_RECORD")).toEqual({
      allowed: false,
      reason: "ROLE_DENIED",
    });
    expect(decisionFor("STUDENT", "STUDENT_APPLICATION_REVIEW")).toEqual({
      allowed: false,
      reason: "ROLE_DENIED",
    });
    expect(decisionFor("STAFF", "PAYMENT_CORRECT")).toEqual({
      allowed: false,
      reason: "ROLE_DENIED",
    });
    expect(decisionFor("STAFF", "ROLE_PERMISSION_MANAGE")).toEqual({
      allowed: false,
      reason: "ROLE_DENIED",
    });
  });

  it("combines valid roles without bypassing the account status", () => {
    expect(authorize({
      action: "PAYMENT_RECORD",
      principal: principal(["STUDENT", "STAFF"]),
    })).toEqual({ allowed: true });
    expect(authorize({
      action: "PAYMENT_RECORD",
      principal: principal(["STUDENT", "STAFF"], "SUSPENDED"),
    })).toEqual({ allowed: false, reason: "STATUS_DENIED" });
  });
});

describe("deny-by-default guard", () => {
  it("denies missing sessions, unknown actions and malformed principals", () => {
    expect(authorize({ action: "CLASS_SESSION_READ" })).toEqual({
      allowed: false,
      reason: "UNAUTHENTICATED",
    });
    expect(authorize({
      action: "UNLISTED_ACTION",
      principal: principal(["ADMIN"]),
    })).toEqual({ allowed: false, reason: "UNKNOWN_ACTION" });
    expect(authorize({
      action: "CLASS_SESSION_READ",
      principal: { roles: [], status: "ACTIVE", userId: "user-1" },
    })).toEqual({ allowed: false, reason: "INVALID_PRINCIPAL" });
  });

  it("requires ownership context instead of trusting a requested identifier", () => {
    expect(authorize({
      action: "PROFILE_READ_OWN",
      principal: principal(["STUDENT"]),
    })).toEqual({ allowed: false, reason: "OWNERSHIP_REQUIRED" });
  });

  it("throws a typed generic error without resource details", () => {
    let error: unknown;
    try {
      requireAuthorization({
        action: "AUDIT_READ",
        principal: principal(["STAFF"]),
        resource: { ownerId: "sensitive-target" },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AuthorizationDeniedError);
    expect(error).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "La operación no está autorizada.",
      reason: "ROLE_DENIED",
    });
    expect(String(error)).not.toContain("sensitive-target");
  });
});
