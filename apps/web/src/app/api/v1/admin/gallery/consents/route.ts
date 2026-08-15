import { validateGalleryConsent } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request) => Response.json(
  await (await getAuthService()).createGalleryConsent(request, await readValidatedJson(request, validateGalleryConsent)),
  { status: 201 },
));
