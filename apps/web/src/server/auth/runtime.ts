import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createDynamoDbAdapter,
  MembershipRepository,
  MembershipPlanRepository,
  PaymentRepository,
  SearchTokenService,
  UserRepository,
} from "@gym-adr/data-access";

import { resolveAuthConfig } from "./auth-config";
import { AuthService } from "./auth-service";
import { CognitoTokenClient } from "./cognito-client";
import { FixedWindowRateLimiter } from "./rate-limiter";
import {
  LocalReceiptUploadSigner,
  S3ReceiptUploadSigner,
} from "../payments/receipt-upload";

let servicePromise: Promise<AuthService> | undefined;
const limiter = new FixedWindowRateLimiter();

const loadAuthEnvironment = async (): Promise<Readonly<Record<string, string | undefined>>> => {
  if (process.env.APP_ENVIRONMENT === "local") return process.env;
  const prefix = process.env.AUTH_CONFIG_PARAMETER_PREFIX;
  const region = process.env.AWS_REGION;
  if (prefix === undefined || region === undefined) {
    throw new Error("Missing authentication parameter configuration");
  }
  const names = {
    APP_BASE_URL: `${prefix}/app-base-url`,
    COGNITO_CLIENT_ID: `${prefix}/client-id`,
    COGNITO_HOSTED_UI_BASE_URL: `${prefix}/hosted-ui-base-url`,
    COGNITO_REDIRECT_URI: `${prefix}/redirect-uri`,
    COGNITO_USER_POOL_ID: `${prefix}/user-pool-id`,
  } as const;
  const client = new SSMClient({ region });
  try {
    const result = await client.send(new GetParametersCommand({ Names: Object.values(names) }));
    const byName = new Map(result.Parameters?.map((entry) => [entry.Name, entry.Value]) ?? []);
    if ((result.InvalidParameters?.length ?? 0) > 0) {
      throw new Error("Authentication parameters are incomplete");
    }
    return {
      ...process.env,
      ...Object.fromEntries(Object.entries(names).map(([key, name]) => [key, byName.get(name)])),
    };
  } finally {
    client.destroy();
  }
};

const loadSearchKey = async (): Promise<Uint8Array> => {
  if (process.env.APP_ENVIRONMENT === "local") {
    const value = process.env.SEARCH_TOKEN_HMAC_KEY;
    if (value === undefined || value.length < 32) {
      throw new Error("Missing local search token key");
    }
    return new TextEncoder().encode(value);
  }

  const secretArn = process.env.SEARCH_TOKEN_SECRET_ARN;
  const region = process.env.AWS_REGION;
  if (secretArn === undefined || region === undefined) {
    throw new Error("Missing search token secret configuration");
  }
  const client = new SecretsManagerClient({ region });
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    if (result.SecretString === undefined || result.SecretString.length < 32) {
      throw new Error("Search token secret is invalid");
    }
    return new TextEncoder().encode(result.SecretString);
  } finally {
    client.destroy();
  }
};

const createService = async (): Promise<AuthService> => {
  const config = resolveAuthConfig(await loadAuthEnvironment());
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (tableName === undefined) {
    throw new Error("Missing DynamoDB table configuration");
  }
  const region = process.env.AWS_REGION;
  if (config.environment !== "local" && region === undefined) {
    throw new Error("Missing AWS region for DynamoDB");
  }
  const adapter = createDynamoDbAdapter({
    environment: config.environment,
    ...(config.environment === "local"
      ? (process.env.DYNAMODB_ENDPOINT === undefined
          ? {}
          : { endpoint: process.env.DYNAMODB_ENDPOINT })
      : { region: region ?? "" }),
  });
  const users = new UserRepository(
    adapter,
    tableName,
    new SearchTokenService([
      { secret: await loadSearchKey(), version: "v1" },
    ]),
  );
  const receipts = config.environment === "local"
    ? new LocalReceiptUploadSigner()
    : (() => {
        const bucket = process.env.PAYMENT_RECEIPTS_BUCKET_NAME;
        if (bucket === undefined || region === undefined) {
          throw new Error("Missing private payment receipt bucket configuration");
        }
        return new S3ReceiptUploadSigner(new S3Client({ region }), bucket);
      })();
  return new AuthService({
    config,
    rateLimiter: limiter,
    memberships: new MembershipRepository(adapter, tableName),
    payments: new PaymentRepository(adapter, tableName),
    plans: new MembershipPlanRepository(adapter, tableName),
    tokens: new CognitoTokenClient(config),
    receipts,
    users,
  });
};

export const getAuthService = (): Promise<AuthService> => {
  servicePromise ??= createService().catch((error: unknown) => {
    servicePromise = undefined;
    throw error;
  });
  return servicePromise;
};
