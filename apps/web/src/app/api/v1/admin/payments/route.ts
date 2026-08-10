import { validateRecordPayment } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request, context) => {
  const input = await readValidatedJson(request, validateRecordPayment);
  const result = await (await getAuthService()).recordAdminPayment(
    request,
    context.correlationId,
    input,
  );
  return Response.json(result, { status: result.disposition === "CREATED" ? 201 : 200 });
});
