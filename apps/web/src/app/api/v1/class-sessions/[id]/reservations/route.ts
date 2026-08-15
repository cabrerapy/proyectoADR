import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { createApiHandler } from "@/server/http/route-handler";

export const POST = createApiHandler(async (request) => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const classId = segments.at(-2);
  if (classId === undefined) {
    throw new ApiError(422, apiErrorCodes.validationError, "La sesión no es válida.");
  }
  const result = await (await getAuthService()).reserveOwnClass(request, classId);
  return Response.json(result, {
    status: result.disposition === "CREATED" ? 201 : 200,
  });
});
