import { getAuthService } from "@/server/auth/runtime";
import { createApiHandler } from "@/server/http/route-handler";

export const GET = createApiHandler(async (request) =>
  (await getAuthService()).beginLogin(request),
);
