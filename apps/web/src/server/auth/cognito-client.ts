import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { AuthConfig } from "./auth-config";

export interface VerifiedIdentity {
  readonly cognitoSub: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface CognitoTokenPort {
  exchangeCode(code: string, codeVerifier: string): Promise<string>;
  verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdentity>;
  verifySessionToken(idToken: string): Promise<VerifiedIdentity>;
}

const safeName = (claims: Record<string, unknown>, email: string): string => {
  if (typeof claims.name === "string" && claims.name.trim().length >= 3) {
    return claims.name.trim();
  }
  const combined = [claims.given_name, claims.family_name]
    .filter((value): value is string => typeof value === "string")
    .join(" ").trim();
  const emailName = email.split("@")[0] ?? "";
  return combined.length >= 3
    ? combined
    : emailName.length >= 3
      ? emailName
      : "Alumno";
};

export class CognitoTokenClient implements CognitoTokenPort {
  private readonly keySet: JWTVerifyGetKey;

  constructor(
    private readonly config: AuthConfig,
    keySet: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUrl)),
  ) {
    this.keySet = keySet;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(this.config.tokenUrl, {
      body: new URLSearchParams({
        client_id: this.config.clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.config.callbackUrl,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Cognito token exchange failed");
    const value: unknown = await response.json();
    if (
      typeof value !== "object" || value === null || !("id_token" in value) ||
      typeof value.id_token !== "string" || value.id_token.length > 20_000
    ) throw new Error("Cognito token response is invalid");
    return value.id_token;
  }

  async verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdentity> {
    return this.verify(idToken, expectedNonce);
  }

  async verifySessionToken(idToken: string): Promise<VerifiedIdentity> {
    return this.verify(idToken);
  }

  private async verify(idToken: string, expectedNonce?: string): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify(idToken, this.keySet, {
      audience: this.config.clientId,
      issuer: this.config.issuer,
    });
    if (
      payload.token_use !== "id" ||
      (expectedNonce !== undefined && payload.nonce !== expectedNonce) ||
      typeof payload.sub !== "string" || typeof payload.email !== "string" ||
      payload.email_verified !== true
    ) throw new Error("Cognito identity claims are invalid");
    return {
      cognitoSub: payload.sub,
      displayName: safeName(payload, payload.email),
      email: payload.email,
      emailVerified: true,
    };
  }
}
