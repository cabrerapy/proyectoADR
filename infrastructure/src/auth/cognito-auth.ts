import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} from "aws-cdk-lib";
import {
  AccountRecovery,
  ClientAttributes,
  FeaturePlan,
  Mfa,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolDomain,
  UserPoolIdentityProviderFacebook,
  UserPoolIdentityProviderGoogle,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment.js";
import { resolveAuthEnvironmentConfig } from "./auth-environment.js";

export interface CognitoAuthProps {
  readonly environmentConfig: EnvironmentConfig;
  readonly webBaseUrl: string;
}

const projectName = "gym-adr-platform";

export class CognitoAuth extends Construct {
  readonly appBaseUrl: string;
  readonly callbackUrl: string;
  readonly client: UserPoolClient;
  readonly domain: UserPoolDomain;
  readonly userPool: UserPool;

  constructor(scope: Construct, id: string, props: CognitoAuthProps) {
    super(scope, id);

    const { environmentConfig } = props;
    const authConfig = resolveAuthEnvironmentConfig(
      environmentConfig,
      props.webBaseUrl,
    );
    const retain = environmentConfig.name === "production";
    this.appBaseUrl = authConfig.logoutUrls[0] ?? props.webBaseUrl;
    this.callbackUrl = authConfig.callbackUrls[0] ?? `${props.webBaseUrl}/api/auth/callback/cognito`;

    this.userPool = new UserPool(this, "UserPool", {
      accountRecovery: AccountRecovery.NONE,
      autoVerify: { email: true },
      deletionProtection: retain,
      featurePlan: FeaturePlan.LITE,
      mfa: Mfa.OFF,
      selfSignUpEnabled: false,
      signInCaseSensitive: false,
      standardAttributes: {
        email: { mutable: true, required: true },
        familyName: { mutable: true, required: false },
        givenName: { mutable: true, required: false },
      },
      userPoolName: `${projectName}-${environmentConfig.name}-users`,
    });
    this.userPool.applyRemovalPolicy(
      retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    );

    const googleSecret = Secret.fromSecretNameV2(
      this,
      "GoogleOAuthSecret",
      authConfig.googleSecretName,
    );
    const facebookSecret = Secret.fromSecretNameV2(
      this,
      "FacebookOAuthSecret",
      authConfig.facebookSecretName,
    );

    const googleProvider = new UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        attributeMapping: {
          email: ProviderAttribute.GOOGLE_EMAIL,
          emailVerified: ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
          familyName: ProviderAttribute.GOOGLE_FAMILY_NAME,
          givenName: ProviderAttribute.GOOGLE_GIVEN_NAME,
        },
        clientId: googleSecret.secretValueFromJson("clientId").toString(),
        clientSecretValue: googleSecret.secretValueFromJson("clientSecret"),
        scopes: ["openid", "email", "profile"],
        userPool: this.userPool,
      },
    );
    const facebookProvider = new UserPoolIdentityProviderFacebook(
      this,
      "FacebookProvider",
      {
        attributeMapping: {
          email: ProviderAttribute.FACEBOOK_EMAIL,
          familyName: ProviderAttribute.FACEBOOK_LAST_NAME,
          givenName: ProviderAttribute.FACEBOOK_FIRST_NAME,
        },
        clientId: facebookSecret.secretValueFromJson("clientId").toString(),
        clientSecret: facebookSecret
          .secretValueFromJson("clientSecret")
          .unsafeUnwrap(),
        scopes: ["public_profile", "email"],
        userPool: this.userPool,
      },
    );

    const readableAttributes = new ClientAttributes().withStandardAttributes({
      email: true,
      emailVerified: true,
      familyName: true,
      givenName: true,
    });
    const writableAttributes = new ClientAttributes().withStandardAttributes({
      email: true,
      familyName: true,
      givenName: true,
    });
    this.client = this.userPool.addClient("WebClient", {
      accessTokenValidity: Duration.minutes(15),
      authFlows: {},
      enableTokenRevocation: true,
      generateSecret: false,
      idTokenValidity: Duration.minutes(15),
      oAuth: {
        callbackUrls: [...authConfig.callbackUrls],
        flows: { authorizationCodeGrant: true },
        logoutUrls: [...authConfig.logoutUrls],
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
      },
      preventUserExistenceErrors: true,
      readAttributes: readableAttributes,
      refreshTokenValidity: Duration.days(1),
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.GOOGLE,
        UserPoolClientIdentityProvider.FACEBOOK,
      ],
      userPoolClientName: `${projectName}-${environmentConfig.name}-web`,
      writeAttributes: writableAttributes,
    });
    this.client.node.addDependency(googleProvider);
    this.client.node.addDependency(facebookProvider);

    this.domain = this.userPool.addDomain("HostedUiDomain", {
      cognitoDomain: {
        domainPrefix: `gym-adr-${environmentConfig.name}-${Stack.of(this).account}`,
      },
    });

    for (const [key, value] of Object.entries({
      CostCenter: "gym-adr",
      Environment: environmentConfig.name,
      ManagedBy: "aws-cdk",
      Owner: "gym-adr-team",
      Project: projectName,
    })) {
      Tags.of(this).add(key, value);
    }

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.client.userPoolClientId,
    });
    new CfnOutput(this, "HostedUiBaseUrl", {
      value: this.domain.baseUrl(),
    });
  }
}
