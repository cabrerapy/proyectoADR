import { validateOwnClassScheduleQuery, type ValidationIssue } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes, type FieldErrors } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

const fields = (issues: readonly ValidationIssue[]): FieldErrors =>
  Object.fromEntries(issues.map((issue) => [issue.path.join(".") || "$", [issue.message]]));

export const GET = createApiHandler(async (request) => {
  const result = validateOwnClassScheduleQuery(new URL(request.url).searchParams);
  if (!result.success) {
    throw new ApiError(422, apiErrorCodes.validationError, "La consulta no es válida.", {
      fieldErrors: fields(result.issues),
    });
  }
  return Response.json(await (await getAuthService()).getOwnClassSchedule(request, result.data));
});
