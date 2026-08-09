import {
  validateCreateMembership,
  validateMembershipHistoryQuery,
  type ValidationIssue,
} from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes, type FieldErrors } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const fieldErrors = (issues: readonly ValidationIssue[]): FieldErrors => {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) (errors[issue.path.join(".") || "$" ] ??= []).push(issue.message);
  return errors;
};

export const GET = createApiHandler(async (request) => {
  const result = validateMembershipHistoryQuery(new URL(request.url).searchParams);
  if (!result.success) {
    throw new ApiError(422, apiErrorCodes.validationError, "La consulta no es válida.", {
      fieldErrors: fieldErrors(result.issues),
    });
  }
  return Response.json(await (await getAuthService()).listAdminMemberships(request, result.data));
});

export const POST = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateCreateMembership);
  return Response.json(
    await (await getAuthService()).createAdminMembership(request, context.correlationId, input),
    { status: 201 },
  );
});
