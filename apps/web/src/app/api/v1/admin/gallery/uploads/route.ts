import { validateGalleryUpload } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request) => {
  const input = await readValidatedJson(request, validateGalleryUpload);
  return Response.json(await (await getAuthService()).createGalleryUpload(request, input));
});
