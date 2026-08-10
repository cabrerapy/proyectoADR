import { validatePaymentReceiptQuery } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) => {
  const result = validatePaymentReceiptQuery(new URL(request.url).searchParams);
  if (!result.success) throw new ApiError(422, apiErrorCodes.validationError, "La consulta no es válida.");
  return Response.json(await (await getAuthService()).getOwnPaymentReceipt(request, result.data));
});
