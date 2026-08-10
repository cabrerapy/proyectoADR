import { validateCorrectPayment } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateCorrectPayment);
  const paymentId = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
  if (paymentId === undefined || paymentId !== input.originalPaymentId) {
    throw new ApiError(422, apiErrorCodes.validationError, "El pago de la ruta no coincide con la corrección.");
  }
  const result = await (await getAuthService()).correctAdminPayment(request, context.correlationId, input);
  return Response.json(result, { status: result.disposition === "CREATED" ? 201 : 200 });
});
