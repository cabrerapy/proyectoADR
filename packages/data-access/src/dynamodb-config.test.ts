import { describe, expect, it } from "vitest";

import { resolveDynamoDbClientConfig } from "./dynamodb-config";
import { DynamoDbRepositoryError } from "./dynamodb-errors";

describe("DynamoDB client configuration", () => {
  it("uses only loopback and placeholder credentials for local", () => {
    const config = resolveDynamoDbClientConfig({ environment: "local" });

    expect(config).toMatchObject({
      credentials: {
        accessKeyId: "localplaceholder",
        secretAccessKey: "localplaceholder",
      },
      endpoint: "http://127.0.0.1:8000",
      maxAttempts: 3,
      region: "local",
    });
  });

  it.each([
    "http://192.168.1.20:8000",
    "https://127.0.0.1:8000",
    "http://user:password@127.0.0.1:8000",
    "http://127.0.0.1:8000/path",
  ])("rejects unsafe local endpoint %s", (endpoint) => {
    expect(() =>
      resolveDynamoDbClientConfig({ endpoint, environment: "local" }),
    ).toThrow(DynamoDbRepositoryError);
  });

  it.each(["development", "production"] as const)(
    "uses the default AWS credential chain for %s",
    (environment) => {
      const config = resolveDynamoDbClientConfig({
        environment,
        region: "sa-east-1",
      });

      expect(config.region).toBe("sa-east-1");
      expect(config.credentials).toBeUndefined();
      expect(config.endpoint).toBeUndefined();
    },
  );

  it("never permits an endpoint override in production", () => {
    expect(() =>
      resolveDynamoDbClientConfig({
        endpoint: "http://127.0.0.1:8000",
        environment: "production",
        region: "sa-east-1",
      }),
    ).toThrow("Los ambientes remotos no permiten sobrescribir el endpoint");
  });

  it("requires an explicit valid AWS region remotely", () => {
    expect(() =>
      resolveDynamoDbClientConfig({ environment: "development" }),
    ).toThrow("La región AWS debe ser explícita");
  });
});
