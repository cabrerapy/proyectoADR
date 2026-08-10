import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { getAuthService } from "@/server/auth/runtime";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) => {
  const token = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[0-9a-f-]{36}$/u.test(token)) throw new ApiError(404, apiErrorCodes.notFound, "El enlace no existe.");
  return (await getAuthService()).consumeLocalPaymentReceiptDownload(token);
});
