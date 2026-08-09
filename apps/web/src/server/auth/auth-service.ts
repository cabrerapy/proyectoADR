import { randomUUID } from "node:crypto";

import type { CreatePendingUserResult } from "@gym-adr/data-access";

import { ApiError, apiErrorCodes } from "../http/api-error";
import type { AuthConfig } from "./auth-config";
import { oauthCookieNames, readCookies, serializeCookie, sessionCookieName } from "./cookies";
import type { CognitoTokenPort } from "./cognito-client";
import { createOAuthTransaction, secureEqual } from "./oauth-transaction";
import { requestRateKey, type RateLimiter } from "./rate-limiter";

export interface PendingUserPort {
  createPending(input: {
    readonly cognitoSub: string;
    readonly createdAt: string;
    readonly displayName: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly userId: string;
  }): Promise<CreatePendingUserResult>;
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

export class AuthService {
  private readonly clock: () => Date;
  private readonly ids: () => string;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.ids = dependencies.ids ?? randomUUID;
  }

  beginLogin(request: Request): Response {
    if (!this.dependencies.rateLimiter.consume(requestRateKey(request, "login"), 10, 60_000)) {
      throw new ApiError(429, apiErrorCodes.rateLimited, "Demasiados intentos. Intenta nuevamente en un minuto.");
    }
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
    if (!this.dependencies.rateLimiter.consume(requestRateKey(request, "callback"), 20, 60_000)) {
      throw new ApiError(429, apiErrorCodes.rateLimited, "Demasiados intentos. Intenta nuevamente en un minuto.");
    }
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
      const headers = new Headers({ location: this.dependencies.config.appBaseUrl });
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
}
