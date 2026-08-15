import { validateGymSettingsCommand } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) => Response.json(
  await (await getAuthService()).getAdminSettings(request) ?? null,
));

export const PUT = createApiHandler(async (request, context) => Response.json(
  await (await getAuthService()).saveAdminSettings(request, context.correlationId, await readValidatedJson(request, validateGymSettingsCommand)),
));
