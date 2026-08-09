export type AuthEnvironment = "local" | "development" | "production";

export interface AuthConfig {
  readonly appBaseUrl: string;
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly environment: AuthEnvironment;
  readonly hostedUiBaseUrl: string;
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly tokenUrl: string;
}

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

const required = (values: EnvironmentValues, name: string): string => {
  const value = values[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing authentication configuration: ${name}`);
  }
  return value;
};

const exactBaseUrl = (value: string, allowHttp: boolean): string => {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
    (url.protocol === "http:" && url.hostname !== "localhost") ||
    url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== ""
  ) throw new Error("Invalid authentication base URL");
  return url.origin;
};

export const resolveAuthConfig = (values: EnvironmentValues): AuthConfig => {
  const environment = required(values, "APP_ENVIRONMENT");
  if (!(["local", "development", "production"] as const).includes(environment as AuthEnvironment)) {
    throw new Error("Invalid authentication environment");
  }
  const typedEnvironment = environment as AuthEnvironment;
  const local = typedEnvironment === "local";
  const appBaseUrl = exactBaseUrl(required(values, "APP_BASE_URL"), local);
  const hostedUiBaseUrl = exactBaseUrl(required(values, "COGNITO_HOSTED_UI_BASE_URL"), false);
  const callback = new URL(required(values, "COGNITO_REDIRECT_URI"));
  if (
    callback.pathname !== "/api/auth/callback/cognito" || callback.search !== "" ||
    callback.hash !== "" ||
    (local ? callback.origin !== "http://localhost:3000" : callback.origin !== appBaseUrl)
  ) throw new Error("Invalid Cognito callback URL");
  const region = required(values, "AWS_REGION");
  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/u.test(region)) {
    throw new Error("Invalid AWS region for Cognito");
  }
  const userPoolId = required(values, "COGNITO_USER_POOL_ID");
  if (!/^[\w-]+_[0-9A-Za-z]+$/u.test(userPoolId)) {
    throw new Error("Invalid Cognito user pool ID");
  }
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  return {
    appBaseUrl,
    callbackUrl: callback.toString(),
    clientId: required(values, "COGNITO_CLIENT_ID"),
    environment: typedEnvironment,
    hostedUiBaseUrl,
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    tokenUrl: `${hostedUiBaseUrl}/oauth2/token`,
  };
};
