import { validateAdminPaymentQuery, validateRecordPayment, type ValidationIssue } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes, type FieldErrors } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const fieldErrors = (issues: readonly ValidationIssue[]): FieldErrors => Object.fromEntries(
  issues.map((issue) => [issue.path.join(".") || "$", [issue.message]]),
);

export const GET = createApiHandler(async (request) => {
  const result = validateAdminPaymentQuery(new URL(request.url).searchParams);
  if (!result.success) throw new ApiError(422, apiErrorCodes.validationError, "La consulta no es válida.", { fieldErrors: fieldErrors(result.issues) });
  return Response.json(await (await getAuthService()).listAdminPayments(request, result.data));
});

export const POST = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateRecordPayment);
  const result = await (await getAuthService()).recordAdminPayment(
    request,
    context.correlationId,
    input,
  );
  return Response.json(result, { status: result.disposition === "CREATED" ? 201 : 200 });
});
