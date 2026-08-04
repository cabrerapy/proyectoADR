import { expect, test } from "@playwright/test";

test("serves the BFF health contract with request correlation", async ({
  request,
}) => {
  const correlationId = "123e4567-e89b-12d3-a456-426614174000";
  const response = await request.get("/api/v1/health", {
    headers: { "x-correlation-id": correlationId },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-correlation-id"]).toBe(correlationId);
  await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
});
