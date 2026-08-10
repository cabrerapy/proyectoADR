import { validateCancelClassSession } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request, context) => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const classId = segments.at(-2);
  if (classId === undefined) {
    throw new ApiError(422, apiErrorCodes.validationError, "La sesión no es válida.");
  }
  return Response.json(await (await getAuthService()).cancelAdminClassSession(
    request,
    context.correlationId,
    classId,
    await readValidatedJson(request, validateCancelClassSession),
  ));
});
