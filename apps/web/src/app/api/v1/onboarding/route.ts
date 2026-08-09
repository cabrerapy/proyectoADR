import { validateCompleteProfile } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) =>
  Response.json(await (await getAuthService()).getOnboardingProfile(request)),
);

export const PATCH = createApiHandler(async (request) => {
  const service = await getAuthService();
  await service.getOnboardingProfile(request);
  const input = await readValidatedJson(request, validateCompleteProfile);
  return Response.json(await service.completeProfile(request, input));
});
