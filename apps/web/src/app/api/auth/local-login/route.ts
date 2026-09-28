import { serializeCookie, sessionCookieName } from "@/server/auth/cookies";
import { LOCAL_SESSION_PREFIX, isLocalIdentityAlias } from "@/server/auth/local-token-client";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

const destinations = {
  admin: "/admin",
  inactive: "/me/profile",
  pending: "/me/profile",
  staff: "/admin",
  student: "/me/profile",
  suspended: "/me/profile",
} as const;

export const GET = createApiHandler((request) => {
  if (process.env.APP_ENVIRONMENT !== "local" || process.env.LOCAL_AUTH_ENABLED !== "1") {
    throw new ApiError(404, apiErrorCodes.notFound, "La autenticación local no está disponible.");
  }
  const alias = new URL(request.url).searchParams.get("profile") ?? "";
  if (!isLocalIdentityAlias(alias)) {
    throw new ApiError(422, apiErrorCodes.validationError, "El perfil local no es válido.");
  }
  const headers = new Headers({ location: new URL(destinations[alias], request.url).toString() });
  headers.append("set-cookie", serializeCookie(
    sessionCookieName("local"),
    `${LOCAL_SESSION_PREFIX}${alias}`,
    { environment: "local", maxAge: 8 * 60 * 60 },
  ));
  return new Response(null, { headers, status: 303 });
});
