import type { ValidationResult } from "@gym-adr/validation";
import { describe, expect, it } from "vitest";

import { GET as getHealth } from "@/app/api/v1/health/route";

import { ApiError, apiErrorCodes } from "./api-error";
import { correlationIdHeader } from "./correlation-id";
import { readValidatedJson, type Validator } from "./request-body";
import {
  createApiHandler,
  type ApiErrorPayload,
} from "./route-handler";

interface NameCommand {
  readonly name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const validateName: Validator<NameCommand> = (value) => {
  if (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0
  ) {
    return { success: true, data: { name: value.name.trim() } };
  }

  const result: ValidationResult<NameCommand> = {
    success: false,
    issues: [
      {
        code: "required",
        message: "El nombre es obligatorio.",
        path: ["name"],
      },
    ],
  };

  return result;
};

const readError = async (response: Response): Promise<ApiErrorPayload> =>
  (await response.json()) as ApiErrorPayload;

describe("BFF HTTP boundary", () => {
  it("returns health data with a safe correlation ID and no-store", async () => {
    const response = await getHealth(
      new Request("http://localhost/api/v1/health"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get(correlationIdHeader)).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok" },
    });
  });

  it("preserves only a valid incoming UUID correlation ID", async () => {
    const correlationId = "123e4567-e89b-12d3-a456-426614174000";
    const handler = createApiHandler(() => new Response(null, { status: 204 }));
    const validResponse = await handler(
      new Request("http://localhost", {
        headers: { [correlationIdHeader]: correlationId.toUpperCase() },
      }),
    );
    const invalidResponse = await handler(
      new Request("http://localhost", {
        headers: { [correlationIdHeader]: "not-a-valid-uuid" },
      }),
    );

    expect(validResponse.headers.get(correlationIdHeader)).toBe(correlationId);
    expect(invalidResponse.headers.get(correlationIdHeader)).not.toBe(
      "not-a-valid-uuid",
    );
  });

  it("sanitizes unexpected errors", async () => {
    const handler = createApiHandler(() => {
      throw new Error("sensitive implementation detail");
    });
    const response = await handler(new Request("http://localhost"));
    const payload = await readError(response);

    expect(response.status).toBe(500);
    expect(payload.code).toBe(apiErrorCodes.internalError);
    expect(JSON.stringify(payload)).not.toContain("sensitive implementation detail");
  });

  it("serializes known errors without exposing extra data", async () => {
    const handler = createApiHandler(() => {
      throw new ApiError(
        422,
        apiErrorCodes.validationError,
        "Entrada inválida.",
        { fieldErrors: { name: ["El nombre es obligatorio."] } },
      );
    });
    const response = await handler(new Request("http://localhost"));
    const payload = await readError(response);

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      code: apiErrorCodes.validationError,
      fieldErrors: { name: ["El nombre es obligatorio."] },
      message: "Entrada inválida.",
    });
  });
});

describe("JSON input validation", () => {
  it("returns validated and normalized data", async () => {
    const request = new Request("http://localhost", {
      body: JSON.stringify({ name: "  Ever  " }),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });

    await expect(readValidatedJson(request, validateName)).resolves.toEqual({
      name: "Ever",
    });
  });

  it.each([
    {
      body: "not-json",
      contentType: "application/json",
      expectedCode: apiErrorCodes.invalidJson,
    },
    {
      body: JSON.stringify({ name: "Ever" }),
      contentType: "text/plain",
      expectedCode: apiErrorCodes.invalidContentType,
    },
    {
      body: JSON.stringify({ name: "" }),
      contentType: "application/json",
      expectedCode: apiErrorCodes.validationError,
    },
  ])("rejects invalid input with $expectedCode", async (example) => {
    const request = new Request("http://localhost", {
      body: example.body,
      headers: { "content-type": example.contentType },
      method: "POST",
    });

    await expect(readValidatedJson(request, validateName)).rejects.toMatchObject({
      code: example.expectedCode,
    });
  });

  it("enforces the configured body limit using actual bytes", async () => {
    const request = new Request("http://localhost", {
      body: JSON.stringify({ name: "demasiado largo" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    await expect(readValidatedJson(request, validateName, 8)).rejects.toMatchObject({
      code: apiErrorCodes.payloadTooLarge,
      status: 413,
    });
  });
});
