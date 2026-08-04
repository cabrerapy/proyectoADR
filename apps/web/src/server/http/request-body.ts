import type {
  ValidationIssue,
  ValidationResult,
} from "@gym-adr/validation";

import {
  ApiError,
  apiErrorCodes,
  type FieldErrors,
} from "./api-error";

export const defaultJsonBodyLimitBytes = 16_384;

export type Validator<T> = (value: unknown) => ValidationResult<T>;

const jsonMediaTypePattern =
  /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/iu;

const toFieldErrors = (
  issues: readonly ValidationIssue[],
): FieldErrors => {
  const fields: Record<string, string[]> = {};

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "$";
    const messages = fields[field] ?? [];
    messages.push(issue.message);
    fields[field] = messages;
  }

  return fields;
};

const assertJsonContentType = (request: Request): void => {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim();

  if (!mediaType || !jsonMediaTypePattern.test(mediaType)) {
    throw new ApiError(
      415,
      apiErrorCodes.invalidContentType,
      "El contenido debe enviarse como JSON.",
    );
  }
};

const assertDeclaredLength = (request: Request, limit: number): void => {
  const contentLength = request.headers.get("content-length");

  if (contentLength === null) {
    return;
  }

  const declaredLength = Number(contentLength);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    throw new ApiError(
      400,
      apiErrorCodes.invalidJson,
      "La longitud declarada del contenido no es válida.",
    );
  }

  if (declaredLength > limit) {
    throw new ApiError(
      413,
      apiErrorCodes.payloadTooLarge,
      "El contenido supera el tamaño permitido.",
    );
  }
};

export const readValidatedJson = async <T>(
  request: Request,
  validator: Validator<T>,
  limit = defaultJsonBodyLimitBytes,
): Promise<T> => {
  assertJsonContentType(request);
  assertDeclaredLength(request, limit);

  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > limit) {
    throw new ApiError(
      413,
      apiErrorCodes.payloadTooLarge,
      "El contenido supera el tamaño permitido.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new ApiError(
      400,
      apiErrorCodes.invalidJson,
      "El contenido JSON no es válido.",
    );
  }

  const result = validator(value);
  if (!result.success) {
    throw new ApiError(
      422,
      apiErrorCodes.validationError,
      "Uno o más campos no son válidos.",
      { fieldErrors: toFieldErrors(result.issues) },
    );
  }

  return result.data;
};
