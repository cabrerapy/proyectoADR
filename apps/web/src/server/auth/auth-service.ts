import { randomUUID } from "node:crypto";

import {
  DynamoDbRepositoryError,
  type CompletePendingProfileInput,
  type CreatePendingUserResult,
} from "@gym-adr/data-access";
import { AuthorizationDeniedError, type UserProfile } from "@gym-adr/domain";
import type { CompleteProfileInput } from "@gym-adr/validation";

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
  findByCognitoSub(cognitoSub: string): Promise<UserProfile | undefined>;
}

export interface OnboardingProfile {
  readonly completed: boolean;
  readonly displayName: string;
  readonly email: string;
  readonly phone?: string;
  readonly status: UserProfile["status"];
  readonly version: number;
}

export interface AuthServiceDependencies {
  readonly clock?: () => Date;
  readonly config: AuthConfig;
  readonly ids?: () => string;
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
