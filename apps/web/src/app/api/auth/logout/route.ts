import { getAuthService } from "@/server/auth/runtime";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request) =>
  (await getAuthService()).logout(request),
);
