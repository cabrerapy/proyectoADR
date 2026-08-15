import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

export const PUT = createApiHandler(async (request) => {
  const token = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[0-9a-f-]{36}$/u.test(token)) {
    throw new ApiError(404, apiErrorCodes.notFound, "La carga firmada no existe.");
  }
  await (await getAuthService()).consumeLocalGalleryUpload(token, request);
  return new Response(null, { status: 204 });
});
