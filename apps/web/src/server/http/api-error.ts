export const apiErrorCodes = {
  authenticationRequired: "AUTHENTICATION_REQUIRED",
  authenticationFailed: "AUTHENTICATION_FAILED",
  authenticationInvalid: "AUTHENTICATION_INVALID",
  conflict: "CONFLICT",
  forbidden: "FORBIDDEN",
  internalError: "INTERNAL_ERROR",
  invalidContentType: "INVALID_CONTENT_TYPE",
  invalidJson: "INVALID_JSON",
  notFound: "NOT_FOUND",
  payloadTooLarge: "PAYLOAD_TOO_LARGE",
  rateLimited: "RATE_LIMITED",
  validationError: "VALIDATION_ERROR",
} as const;

export type ApiErrorCode =
  (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502;

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface ApiErrorOptions {
  readonly fieldErrors?: FieldErrors;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldErrors | undefined;
  readonly status: ApiErrorStatus;

  constructor(
    status: ApiErrorStatus,
    code: ApiErrorCode,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors;
  }
}
