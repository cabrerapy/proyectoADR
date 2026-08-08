import type { EnvironmentConfig } from "../config/environment.js";

export interface AuthEnvironmentConfig {
  readonly callbackUrls: readonly string[];
  readonly facebookSecretName: string;
  readonly googleSecretName: string;
  readonly logoutUrls: readonly string[];
}

const callbackPath = "/api/auth/callback/cognito";

export const resolveAuthEnvironmentConfig = (
  environment: EnvironmentConfig,
  deployedWebBaseUrl: string,
): AuthEnvironmentConfig => {
  const baseUrl = environment.name === "local"
    ? "http://localhost:3000"
    : deployedWebBaseUrl;

  if (
    !baseUrl.startsWith(environment.name === "local" ? "http://localhost:" : "https://") ||
    baseUrl.endsWith("/")
  ) {
    throw new Error(
      `Invalid web base URL for Cognito callbacks in ${environment.name}.`,
    );
  }

  const secretPrefix = `gym-adr-platform/${environment.name}/cognito`;
  return {
    callbackUrls: [`${baseUrl}${callbackPath}`],
    facebookSecretName: `${secretPrefix}/facebook`,
    googleSecretName: `${secretPrefix}/google`,
    logoutUrls: [baseUrl],
  };
};
