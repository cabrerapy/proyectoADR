export const DYNAMODB_ERROR_CODES = [
  "CONDITIONAL_CHECK_FAILED",
  "CLASS_SESSION_CONFLICT",
  "CLASS_SESSION_RECORD_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_RECORD_INVALID",
  "INVALID_INPUT",
  "MEMBERSHIP_CONFLICT",
  "MEMBERSHIP_RECORD_INVALID",
  "PAYMENT_CONFLICT",
  "PAYMENT_RECORD_INVALID",
  "PAYMENT_STATE_CONFLICT",
  "RESOURCE_NOT_FOUND",
  "RESERVATION_RECORD_INVALID",
  "THROTTLED",
  "TRANSACTION_CANCELLED",
  "UNPROCESSED_KEYS",
  "USER_EMAIL_CONFLICT",
  "USER_ONBOARDING_COMPLETE",
  "USER_ONBOARDING_INCOMPLETE",
  "USER_RECORD_INVALID",
  "USER_STATUS_INVALID",
  "USER_VERSION_CONFLICT",
  "UNKNOWN",
] as const;

export type DynamoDbErrorCode = (typeof DYNAMODB_ERROR_CODES)[number];

export class DynamoDbRepositoryError extends Error {
  readonly code: DynamoDbErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DynamoDbErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DynamoDbRepositoryError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

const errorName = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  typeof error.name === "string"
    ? error.name
    : undefined;

export const mapDynamoDbError = (
  error: unknown,
): DynamoDbRepositoryError => {
  if (error instanceof DynamoDbRepositoryError) {
    return error;
  }

  switch (errorName(error)) {
    case "ConditionalCheckFailedException":
      return new DynamoDbRepositoryError(
        "CONDITIONAL_CHECK_FAILED",
        "La condición de persistencia no se cumplió.",
      );
    case "ResourceNotFoundException":
      return new DynamoDbRepositoryError(
        "RESOURCE_NOT_FOUND",
        "El recurso de persistencia no está disponible.",
      );
    case "ThrottlingException":
    case "ProvisionedThroughputExceededException":
    case "RequestLimitExceeded":
      return new DynamoDbRepositoryError(
        "THROTTLED",
        "DynamoDB limitó temporalmente la operación.",
        { retryable: true },
      );
    case "TransactionCanceledException":
      return new DynamoDbRepositoryError(
        "TRANSACTION_CANCELLED",
        "La transacción de persistencia fue cancelada.",
      );
    default:
      return new DynamoDbRepositoryError(
        "UNKNOWN",
        "La operación de persistencia no pudo completarse.",
      );
  }
};

export const invalidDynamoDbInput = (
  message: string,
): DynamoDbRepositoryError =>
  new DynamoDbRepositoryError("INVALID_INPUT", message);
