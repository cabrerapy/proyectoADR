export const apiErrorCodes = {
  internalError: "INTERNAL_ERROR",
  invalidContentType: "INVALID_CONTENT_TYPE",
  invalidJson: "INVALID_JSON",
  payloadTooLarge: "PAYLOAD_TOO_LARGE",
  validationError: "VALIDATION_ERROR",
} as const;

export type ApiErrorCode =
  (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

export type ApiErrorStatus = 400 | 413 | 415 | 422 | 500;

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
