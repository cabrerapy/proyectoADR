import type { AuthEnvironment } from "./auth-config";

export const oauthCookieNames = {
  nonce: "gym_oauth_nonce",
  state: "gym_oauth_state",
  verifier: "gym_oauth_verifier",
} as const;

export const sessionCookieName = (environment: AuthEnvironment): string =>
  environment === "local" ? "gym_session" : "__Host-gym_session";

export const readCookies = (header: string | null): Readonly<Record<string, string>> => {
  if (header === null) return {};
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const];
  }));
};

export const serializeCookie = (
  name: string,
  value: string,
  options: { readonly environment: AuthEnvironment; readonly maxAge: number },
): string => {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAge}`];
  if (options.environment !== "local") parts.push("Secure");
  return parts.join("; ");
};
