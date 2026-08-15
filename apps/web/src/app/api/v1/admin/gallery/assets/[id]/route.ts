import { validateGalleryPublication } from "@gym-adr/validation";

import { getAuthService } from "@/server/auth/runtime";
import { ApiError, apiErrorCodes } from "@/server/http/api-error";
import { readValidatedJson } from "@/server/http/request-body";
import { createApiHandler } from "@/server/http/route-handler";

const routeAssetId = (request: Request): string => {
  const id = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(id)) {
    throw new ApiError(422, apiErrorCodes.validationError, "La imagen no es válida.");
  }
  return id;
};

export const GET = createApiHandler(async (request) => Response.json(
  await (await getAuthService()).getAdminGalleryAsset(request, routeAssetId(request)),
));

export const PATCH = createApiHandler(async (request) => Response.json(
  await (await getAuthService()).changeGalleryPublication(
    request,
    routeAssetId(request),
    await readValidatedJson(request, validateGalleryPublication),
  ),
));
