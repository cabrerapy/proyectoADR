import { validateUpdateSchedulingCatalog } from "@gym-adr/validation";
import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const PATCH = createApiHandler(async (request, context) => {
  const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  if (id === undefined) throw new ApiError(422, apiErrorCodes.validationError, "El entrenador no es válido.");
  return Response.json(await (await getAuthService()).updateAdminSchedulingCatalog(request, context.correlationId, "trainers", id, await readValidatedJson(request, validateUpdateSchedulingCatalog)));
});
