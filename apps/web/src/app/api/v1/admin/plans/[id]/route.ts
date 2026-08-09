import { validateUpdateMembershipPlan } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const planIdFromRequest = (request: Request): string => {
  const segment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  let planId = "";
  try {
    planId = decodeURIComponent(segment ?? "");
  } catch {
    throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el plan solicitado.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(planId)) {
    throw new ApiError(404, apiErrorCodes.notFound, "No se encontró el plan solicitado.");
  }
  return planId;
};

export const GET = createApiHandler(async (request) =>
  Response.json(await (await getAuthService()).getAdminMembershipPlan(request, planIdFromRequest(request))),
);

export const PATCH = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateUpdateMembershipPlan);
  return Response.json(await (await getAuthService()).updateAdminMembershipPlan(
    request,
    context.correlationId,
    planIdFromRequest(request),
    input,
  ));
});
