import { validateClassSessionQuery, validateCreateClassSession } from "@gym-adr/validation";
import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) => {
  const result = validateClassSessionQuery(new URL(request.url).searchParams);
  if (!result.success) throw new ApiError(422, apiErrorCodes.validationError, "La consulta no es válida.");
  return Response.json(await (await getAuthService()).listAdminClassSessions(request, result.data));
});
export const POST = createApiHandler(async (request, context) => Response.json(
  await (await getAuthService()).createAdminClassSession(request, context.correlationId, await readValidatedJson(request, validateCreateClassSession)),
  { status: 201 },
));
