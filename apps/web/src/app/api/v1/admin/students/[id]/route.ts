import { validateTransitionStudentStatus } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const userIdFromRequest = (request: Request): string => {
  const segment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  let userId = "";
  try {
    userId = decodeURIComponent(segment ?? "");
  } catch {
    throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el alumno solicitado.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(userId)) {
    throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el alumno solicitado.");
  }
  return userId;
};

export const GET = createApiHandler(async (request) =>
  Response.json(await (await getAuthService()).getAdminStudent(request, userIdFromRequest(request))),
);

export const PATCH = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateTransitionStudentStatus);
  return Response.json(await (await getAuthService()).transitionAdminStudent(
    request,
    context.correlationId,
    userIdFromRequest(request),
    input,
  ));
});
