import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const base64Url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");

export interface OAuthTransaction {
  readonly codeChallenge: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly state: string;
}

export const createOAuthTransaction = (): OAuthTransaction => {
  const codeVerifier = base64Url(randomBytes(32));
  return {
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    codeVerifier,
    nonce: base64Url(randomBytes(32)),
    state: base64Url(randomBytes(32)),
  };
};

export const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};
