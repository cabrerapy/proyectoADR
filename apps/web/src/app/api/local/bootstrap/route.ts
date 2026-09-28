import { seedLocalFixtures } from "@/server/local/fixtures";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request) => {
  const expectedToken = process.env.LOCAL_BOOTSTRAP_TOKEN;
  if (
    process.env.APP_ENVIRONMENT !== "local" ||
    process.env.LOCAL_AUTH_ENABLED !== "1" ||
    expectedToken === undefined ||
    request.headers.get("x-local-bootstrap-token") !== expectedToken
  ) {
    throw new ApiError(404, apiErrorCodes.notFound, "El bootstrap local no está disponible.");
  }
  return Response.json(await seedLocalFixtures());
});
