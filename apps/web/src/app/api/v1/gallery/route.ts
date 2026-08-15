import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) => {
  const yearMonth = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(yearMonth)) {
    throw new ApiError(422, apiErrorCodes.validationError, "El mes solicitado no es válido.");
  }
  return Response.json(await (await getAuthService()).listPublicGallery(yearMonth), {
    headers: { "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400" },
  });
});
