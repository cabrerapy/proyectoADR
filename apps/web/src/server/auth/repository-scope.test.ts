import { AuthorizationDeniedError } from "@gym-adr/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AuthorizedRepositoryScope,
  RepositoryResourceNotFoundError,
} from "./repository-scope";

const principal = (
  role: "STUDENT" | "STAFF" | "ADMIN",
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "INACTIVE" = "ACTIVE",
) => ({ roles: [role] as const, status, userId: "session-user" });

describe("authorized repository scope", () => {
  it("derives ownership from the authenticated principal", async () => {
    const reader = vi.fn(async (ownerId: string) => ({ ownerId }));
    const result = await new AuthorizedRepositoryScope(principal("STUDENT"))
      .readOwn("PROFILE_READ_OWN", reader);

    expect(result).toEqual({ ownerId: "session-user" });
    expect(reader).toHaveBeenCalledWith("session-user");
  });

  it("never uses a resource identifier as the owner partition", async () => {
    const reader = vi.fn(async (ownerId: string, resourceId: string) => ({
      ownerId,
      resourceId,
    }));
    const result = await new AuthorizedRepositoryScope(principal("STUDENT"))
      .readOwnResource("PAYMENT_READ_OWN", "foreign-payment", reader);

    expect(result).toEqual({
      ownerId: "session-user",
      resourceId: "foreign-payment",
    });
    expect(reader).toHaveBeenCalledWith("session-user", "foreign-payment");
  });

  it("returns the same generic absence for unknown and foreign resource IDs", async () => {
    const scope = new AuthorizedRepositoryScope(principal("STUDENT"));
    const reader = vi.fn(async () => undefined);

    for (const resourceId of ["missing-payment", "another-students-payment"]) {
      await expect(scope.readOwnResource(
        "PAYMENT_READ_OWN",
        resourceId,
        reader,
      )).rejects.toMatchObject({
        code: "RESOURCE_NOT_FOUND",
        message: "No se encontró el recurso solicitado.",
      });
    }
    expect(new RepositoryResourceNotFoundError().message)
      .not.toContain("payment");
  });

  it("denies missing sessions and privilege escalation before repository access", async () => {
    const reader = vi.fn(async () => []);
    expect(() => new AuthorizedRepositoryScope().listOwn(
      "MEMBERSHIP_READ_OWN",
      reader,
    )).toThrow(AuthorizationDeniedError);
    expect(reader).not.toHaveBeenCalled();

    expect(() => new AuthorizedRepositoryScope(principal("STUDENT"))
      .require("PAYMENT_RECORD")).toThrow(AuthorizationDeniedError);
    expect(() => new AuthorizedRepositoryScope(principal("STAFF"))
      .require("PAYMENT_RECORD")).not.toThrow();
    expect(() => new AuthorizedRepositoryScope(principal("STAFF"))
      .require("PAYMENT_CORRECT")).toThrow(AuthorizationDeniedError);
    expect(() => new AuthorizedRepositoryScope(principal("ADMIN"))
      .require("PAYMENT_CORRECT")).not.toThrow();
  });

  it.each(["PENDING", "SUSPENDED", "INACTIVE"] as const)(
    "denies operational access for a %s account",
    (status) => {
      const scope = new AuthorizedRepositoryScope(principal("ADMIN", status));
      expect(() => scope.require("STUDENT_PROFILE_READ_FULL"))
        .toThrow(AuthorizationDeniedError);
    },
  );
});
