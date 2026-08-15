import {
  ApiError,
  apiErrorCodes,
  type ApiErrorCode,
  type FieldErrors,
} from "./api-error";
import {
  correlationIdHeader,
  resolveCorrelationId,
} from "./correlation-id";

export interface ApiRequestContext {
  readonly correlationId: string;
}

export interface ApiErrorPayload {
  readonly code: ApiErrorCode;
  readonly correlationId: string;
  readonly fieldErrors?: FieldErrors;
  readonly message: string;
}

export type ApiHandler = (
  request: Request,
  context: ApiRequestContext,
) => Promise<Response> | Response;

const withStandardHeaders = (
  response: Response,
  correlationId: string,
): Response => {
  const headers = new Headers(response.headers);
  headers.set(correlationIdHeader, correlationId);
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const errorResponse = (error: unknown, correlationId: string): Response => {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          apiErrorCodes.internalError,
          "No fue posible completar la solicitud.",
        );

  const payload: ApiErrorPayload = {
    code: apiError.code,
    correlationId,
    message: apiError.message,
    ...(apiError.fieldErrors === undefined
      ? {}
      : { fieldErrors: apiError.fieldErrors }),
  };

  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
      "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      [correlationIdHeader]: correlationId,
    },
    status: apiError.status,
  });
};

export const createApiHandler =
  (handler: ApiHandler) =>
  async (request: Request): Promise<Response> => {
    const correlationId = resolveCorrelationId(request.headers);

    try {
      const response = await handler(request, { correlationId });
      return withStandardHeaders(response, correlationId);
    } catch (error: unknown) {
      return errorResponse(error, correlationId);
    }
  };
