import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { invalidDynamoDbInput } from "./dynamodb-errors";

export const DATA_ENVIRONMENTS = [
  "local",
  "development",
  "production",
] as const;

export type DataEnvironment = (typeof DATA_ENVIRONMENTS)[number];

export interface DynamoDbConnectionConfig {
  readonly endpoint?: string;
  readonly environment: DataEnvironment;
  readonly region?: string;
}

const defaultLocalEndpoint = "http://127.0.0.1:8000";
const localHostnames = new Set([
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
]);

const assertRemoteRegion = (region: string | undefined): string => {
  if (
    region === undefined ||
    !/^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/u.test(region)
  ) {
    throw invalidDynamoDbInput(
      "La región AWS debe ser explícita y válida fuera del ambiente local.",
    );
  }
  return region;
};

const assertLocalEndpoint = (value: string): string => {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw invalidDynamoDbInput("El endpoint local de DynamoDB no es válido.");
  }

  if (
    endpoint.protocol !== "http:" ||
    !localHostnames.has(endpoint.hostname) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw invalidDynamoDbInput(
      "DynamoDB Local sólo acepta un endpoint HTTP loopback sin credenciales ni ruta.",
    );
  }

  return endpoint.toString().replace(/\/$/u, "");
};

export const resolveDynamoDbClientConfig = (
  config: DynamoDbConnectionConfig,
): DynamoDBClientConfig => {
  if (config.environment === "local") {
    return {
      credentials: {
        accessKeyId: "localplaceholder",
        secretAccessKey: "localplaceholder",
      },
      endpoint: assertLocalEndpoint(config.endpoint ?? defaultLocalEndpoint),
      maxAttempts: 3,
      region: "local",
    };
  }

  if (config.endpoint !== undefined) {
    throw invalidDynamoDbInput(
      "Los ambientes remotos no permiten sobrescribir el endpoint de DynamoDB.",
    );
  }

  return {
    maxAttempts: 3,
    region: assertRemoteRegion(config.region),
  };
};

export const createDynamoDbDocumentClient = (
  config: DynamoDbConnectionConfig,
): DynamoDBDocumentClient => {
  const client = new DynamoDBClient(resolveDynamoDbClientConfig(config));
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      convertClassInstanceToMap: false,
      convertEmptyValues: false,
      removeUndefinedValues: false,
    },
    unmarshallOptions: { wrapNumbers: true },
  });
};
