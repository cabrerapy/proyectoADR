import {
  AuthorizationDeniedError,
  requireAuthorization,
  type AuthorizationAction,
  type AuthorizationPrincipal,
  type OwnedAuthorizationAction,
  type UserProfile,
} from "@gym-adr/domain";

export class RepositoryResourceNotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";

  constructor() {
    super("No se encontró el recurso solicitado.");
    this.name = "RepositoryResourceNotFoundError";
  }
}

export const principalFromProfile = (
  profile: Pick<UserProfile, "id" | "roles" | "status">,
): AuthorizationPrincipal => ({
  roles: profile.roles,
  status: profile.status,
  userId: profile.id,
});

export class AuthorizedRepositoryScope {
  constructor(private readonly principal?: AuthorizationPrincipal) {}

  require(action: AuthorizationAction): void {
    requireAuthorization({
      action,
      ...(this.principal === undefined ? {} : { principal: this.principal }),
    });
  }

  ownUserId(action: OwnedAuthorizationAction): string {
    const principal = this.principal;
    if (principal === undefined) {
      throw new AuthorizationDeniedError("UNAUTHENTICATED");
    }
    const ownerId = principal.userId;
    requireAuthorization({
      action,
      principal,
      resource: { ownerId },
    });
    return ownerId;
  }

  async readOwn<T>(
    action: OwnedAuthorizationAction,
    reader: (ownerId: string) => Promise<T | undefined>,
  ): Promise<T> {
    const result = await reader(this.ownUserId(action));
    if (result === undefined) throw new RepositoryResourceNotFoundError();
    return result;
  }

  async readOwnResource<T>(
    action: OwnedAuthorizationAction,
    resourceId: string,
    reader: (ownerId: string, resourceId: string) => Promise<T | undefined>,
  ): Promise<T> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(resourceId)) {
      throw new RepositoryResourceNotFoundError();
    }
    const result = await reader(this.ownUserId(action), resourceId);
    if (result === undefined) throw new RepositoryResourceNotFoundError();
    return result;
  }

  listOwn<T>(
    action: OwnedAuthorizationAction,
    reader: (ownerId: string) => Promise<T>,
  ): Promise<T> {
    return reader(this.ownUserId(action));
  }

  mutateOwn<T>(
    action: OwnedAuthorizationAction,
    mutation: (ownerId: string) => Promise<T>,
  ): Promise<T> {
    return mutation(this.ownUserId(action));
  }
}
