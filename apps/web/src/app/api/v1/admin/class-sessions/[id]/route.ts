import { validateUpdateClassSession } from "@gym-adr/validation";
import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const PATCH = createApiHandler(async (request, context) => {
  const classId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  if (classId === undefined) throw new ApiError(422, apiErrorCodes.validationError, "La sesión no es válida.");
  return Response.json(await (await getAuthService()).updateAdminClassSession(request, context.correlationId, classId, await readValidatedJson(request, validateUpdateClassSession)));
});
