import { validateUpdateOwnProfile } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) =>
  Response.json(await (await getAuthService()).getOwnProfile(request)),
);

export const PATCH = createApiHandler(async (request) => {
  const input = await readValidatedJson(request, validateUpdateOwnProfile);
  return Response.json(await (await getAuthService()).updateOwnProfile(request, input));
});
