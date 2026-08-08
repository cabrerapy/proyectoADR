import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveEnvironmentConfig } from "../config/environment.js";
import { createInfrastructure } from "../infrastructure-app.js";
import { resolveAuthEnvironmentConfig } from "./auth-environment.js";

const webHostingArtifacts = {
  imageOptimizationFunctionPath: path.resolve(
    import.meta.dirname,
    "../../test-fixtures/open-next/image-optimization-function",
  ),
  serverFunctionPath: path.resolve(
    import.meta.dirname,
    "../../test-fixtures/open-next/server-functions/default",
  ),
  staticAssetsPath: path.resolve(
    import.meta.dirname,
    "../../test-fixtures/open-next/assets",
  ),
};

const synthesize = (environment: "local" | "development" | "production") => {
  const app = new App({ context: { environment } });
  return Template.fromStack(
    createInfrastructure(app, { webHostingArtifacts }).stack,
  );
};

describe("Cognito environment configuration", () => {
  it("restricts local callbacks to loopback and uses isolated secret names", () => {
    const config = resolveAuthEnvironmentConfig(
      resolveEnvironmentConfig("local"),
      "https://ignored.example",
    );

    expect(config).toEqual({
      callbackUrls: ["http://localhost:3000/api/auth/callback/cognito"],
      facebookSecretName: "gym-adr-platform/local/cognito/facebook",
      googleSecretName: "gym-adr-platform/local/cognito/google",
      logoutUrls: ["http://localhost:3000"],
    });
  });

  it("requires HTTPS and exact remote callback paths", () => {
    const environment = resolveEnvironmentConfig("development");
    expect(
      resolveAuthEnvironmentConfig(environment, "https://web.example"),
    ).toMatchObject({
      callbackUrls: ["https://web.example/api/auth/callback/cognito"],
      logoutUrls: ["https://web.example"],
    });
    expect(() =>
      resolveAuthEnvironmentConfig(environment, "http://web.example"),
    ).toThrow("Invalid web base URL");
    expect(() =>
      resolveAuthEnvironmentConfig(environment, "https://web.example/"),
    ).toThrow("Invalid web base URL");
  });
});

describe("Cognito social authentication", () => {
  it.each(["local", "development", "production"] as const)(
    "creates one isolated social-only user pool for %s",
    (environment) => {
      const template = synthesize(environment);

      template.resourceCountIs("AWS::Cognito::UserPool", 1);
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        AccountRecoverySetting: {
          RecoveryMechanisms: [
            { Name: "admin_only", Priority: 1 },
          ],
        },
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
        AutoVerifiedAttributes: ["email"],
        DeletionProtection: environment === "production" ? "ACTIVE" : "INACTIVE",
        MfaConfiguration: "OFF",
        UserPoolName: `gym-adr-platform-${environment}-users`,
        UserPoolTier: "LITE",
        UsernameConfiguration: { CaseSensitive: false },
      });
      template.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 2);
      template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        AllowedOAuthFlows: ["code"],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: Match.arrayWith(["openid", "email", "profile"]),
        ClientName: `gym-adr-platform-${environment}-web`,
        EnableTokenRevocation: true,
        GenerateSecret: false,
        PreventUserExistenceErrors: "ENABLED",
        SupportedIdentityProviders: ["Google", "Facebook"],
      });
      template.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    },
  );

  it("maps only required social attributes and resolves credentials from Secrets Manager", () => {
    const template = synthesize("development");

    template.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
      AttributeMapping: {
        email: "email",
        email_verified: "email_verified",
        family_name: "family_name",
        given_name: "given_name",
      },
      ProviderDetails: {
        authorize_scopes: "openid email profile",
        client_id: Match.objectLike({ "Fn::Join": Match.anyValue() }),
      },
      ProviderName: "Google",
      ProviderType: "Google",
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
      AttributeMapping: {
        email: "email",
        family_name: "last_name",
        given_name: "first_name",
      },
      ProviderDetails: {
        authorize_scopes: "public_profile,email",
        client_id: Match.objectLike({ "Fn::Join": Match.anyValue() }),
      },
      ProviderName: "Facebook",
      ProviderType: "Facebook",
    });
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).toContain(
      "gym-adr-platform/development/cognito/google",
    );
    expect(serialized).toContain(
      "gym-adr-platform/development/cognito/facebook",
    );
    expect(serialized).toContain("SecretString:clientId");
    expect(serialized).toContain("SecretString:clientSecret");
    expect(serialized).not.toContain("example-client-secret");
    expect(serialized).not.toContain("ALLOW_USER_PASSWORD_AUTH");
    expect(serialized).not.toContain("ALLOW_USER_SRP_AUTH");
  });

  it("uses loopback callbacks only for local and CloudFront HTTPS remotely", () => {
    synthesize("local").hasResourceProperties("AWS::Cognito::UserPoolClient", {
      CallbackURLs: ["http://localhost:3000/api/auth/callback/cognito"],
      LogoutURLs: ["http://localhost:3000"],
    });
    const development = JSON.stringify(synthesize("development").toJSON());
    expect(development).toContain("api/auth/callback/cognito");
    expect(development).toContain("DistributionDomainName");
    expect(development).not.toContain("http://localhost:3000");
  });

  it("retains the production pool and adds no Cognito IAM permissions", () => {
    const production = synthesize("production").toJSON();
    const pool = Object.values(production.Resources as Record<string, { Type: string; DeletionPolicy?: string }>).find(
      (resource) => resource.Type === "AWS::Cognito::UserPool",
    );
    expect(pool?.DeletionPolicy).toBe("Retain");

    const policies = Object.values(production.Resources as Record<string, { Type: string; Properties?: unknown }>).filter(
      (resource) => resource.Type === "AWS::IAM::Policy",
    );
    expect(JSON.stringify(policies)).not.toContain("cognito-idp:");
    expect(JSON.stringify(policies)).not.toContain('"Action":"*"');
  });
});
