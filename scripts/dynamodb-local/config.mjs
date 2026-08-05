const defaultPort = 8000;

export const parseDynamoDbLocalPort = (value) => {
  if (value === undefined || value === "") {
    return defaultPort;
  }

  if (!/^\d+$/u.test(value)) {
    throw new Error("DYNAMODB_LOCAL_PORT debe ser un número entero.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("DYNAMODB_LOCAL_PORT debe estar entre 1024 y 65535.");
  }

  return port;
};

export const createDynamoDbLocalConfig = (environment = process.env) => {
  const port = parseDynamoDbLocalPort(environment.DYNAMODB_LOCAL_PORT);

  return {
    credentials: {
      accessKeyId: "localplaceholder",
      secretAccessKey: "localplaceholder",
    },
    endpoint: `http://127.0.0.1:${port}`,
    region: "local",
  };
};
