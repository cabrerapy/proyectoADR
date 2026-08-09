import { validateUpdateMembership } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const membershipIdFromRequest = (request: Request): string => {
  const segment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  let membershipId = "";
  try { membershipId = decodeURIComponent(segment ?? ""); } catch { /* handled below */ }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(membershipId)) {
    throw new ApiError(404, apiErrorCodes.notFound, "No se encontró la membresía solicitada.");
  }
  return membershipId;
};

export const PATCH = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateUpdateMembership);
  return Response.json(await (await getAuthService()).updateAdminMembership(
    request,
    context.correlationId,
    membershipIdFromRequest(request),
    input,
  ));
});
