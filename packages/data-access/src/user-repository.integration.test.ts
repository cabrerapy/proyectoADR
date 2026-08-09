import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDynamoDbAdapter,
  SearchTokenService,
  UserRepository,
} from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-users-${Date.now()}`;
const client = new DynamoDBClient({
  credentials: {
    accessKeyId: "localplaceholder",
    secretAccessKey: "localplaceholder",
  },
  endpoint: "http://127.0.0.1:8000",
  region: "local",
});
const adapter = createDynamoDbAdapter({ environment: "local" });
const legacySearchTokens = new SearchTokenService([
  { secret: new Uint8Array(32).fill(7), version: "v1" },
]);
const rotatedSearchTokens = new SearchTokenService([
  { secret: new Uint8Array(32).fill(7), version: "v1" },
  { secret: new Uint8Array(32).fill(8), version: "v2" },
]);
const legacyRepository = new UserRepository(adapter, tableName, legacySearchTokens);
const repository = new UserRepository(adapter, tableName, rotatedSearchTokens);

const pendingUser = {
  cognitoSub: "google-subject-001",
  createdAt: "2026-08-08T12:00:00Z",
  displayName: "María Núñez",
  email: "MARIA@example.com",
  emailVerified: true,
  userId: "user-001",
} as const;

describe.skipIf(!enabled)("UserRepository with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1-Operational",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        TableName: tableName,
      }),
    );
  });

  afterAll(async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      repository.destroy();
      client.destroy();
    }
  });

  it("creates one pending student and resolves all approved access paths", async () => {
    await expect(legacyRepository.createPending(pendingUser)).resolves.toMatchObject({
      disposition: "CREATED",
      profile: {
        email: "maria@example.com",
        id: "user-001",
        roles: ["STUDENT"],
        status: "PENDING",
        version: 1,
      },
    });
    await expect(legacyRepository.createPending(pendingUser)).resolves.toMatchObject({
      disposition: "EXISTING",
      profile: { id: "user-001" },
    });
    await expect(repository.findByCognitoSub(pendingUser.cognitoSub))
      .resolves.toMatchObject({ id: "user-001" });
    await expect(repository.findByEmail(" maria@EXAMPLE.com "))
      .resolves.toMatchObject({ id: "user-001" });
    await expect(repository.searchByName("María"))
      .resolves.toMatchObject({ profiles: [{ id: "user-001" }] });
    await expect(repository.listByStatus("PENDING"))
      .resolves.toMatchObject({ profiles: [{ id: "user-001" }] });
  });

  it("updates canonical data and backfills a rotated HMAC version atomically", async () => {
    await expect(
      repository.update({
        displayName: "María Benítez",
        email: "maria.benitez@example.com",
        emailVerified: true,
        expectedVersion: 1,
        roles: ["STUDENT"],
        status: "ACTIVE",
        updatedAt: "2026-08-08T13:00:00Z",
        userId: "user-001",
      }),
    ).resolves.toMatchObject({
      displayName: "María Benítez",
      email: "maria.benitez@example.com",
      status: "ACTIVE",
      version: 2,
    });

    await expect(repository.findByEmail("maria@example.com")).resolves.toBeUndefined();
    await expect(repository.findByEmail("maria.benitez@example.com"))
      .resolves.toMatchObject({ id: "user-001", version: 2 });
    await expect(repository.searchByName("Benítez"))
      .resolves.toMatchObject({ profiles: [] });
    await expect(repository.searchByName("María Ben"))
      .resolves.toMatchObject({ profiles: [{ id: "user-001" }] });
  });

  it("completes one pending profile atomically and replays the same request", async () => {
    const onboardingUser = {
      ...pendingUser,
      cognitoSub: "google-subject-onboarding",
      email: "onboarding@example.com",
      userId: "user-onboarding",
    };
    await repository.createPending(onboardingUser);
    const command = {
      displayName: "Ana González",
      expectedVersion: 1,
      onboardingCompletedAt: "2026-08-08T12:30:00Z",
      phone: "+595981123456",
      userId: onboardingUser.userId,
    } as const;

    const first = await repository.completePendingProfile(command);
    const replay = await repository.completePendingProfile(command);
    expect(first).toMatchObject({
      displayName: "Ana González",
      onboardingCompletedAt: "2026-08-08T12:30:00Z",
      phone: "+595981123456",
      roles: ["STUDENT"],
      status: "PENDING",
      version: 2,
    });
    expect(replay).toEqual(first);
    await expect(repository.completePendingProfile({
      ...command,
      phone: "+595981999999",
    })).rejects.toMatchObject({ code: "USER_ONBOARDING_COMPLETE" });
    await expect(repository.searchByName("Ana Gon"))
      .resolves.toMatchObject({ profiles: [{ id: onboardingUser.userId, version: 2 }] });
  });

  it("allows only one owner for a verified email under concurrency", async () => {
    const results = await Promise.allSettled([
      repository.createPending({
        ...pendingUser,
        cognitoSub: "facebook-subject-002",
        email: "shared@example.com",
        userId: "user-002",
      }),
      repository.createPending({
        ...pendingUser,
        cognitoSub: "google-subject-003",
        email: "shared@example.com",
        userId: "user-003",
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "USER_EMAIL_CONFLICT" },
      status: "rejected",
    });
  });

  it("updates only own editable fields with one winner under concurrency", async () => {
    const ownUser = {
      ...pendingUser,
      cognitoSub: "google-subject-own-profile",
      email: "own-profile@example.com",
      userId: "user-own-profile",
    };
    await repository.createPending(ownUser);
    await repository.completePendingProfile({
      displayName: "Luis Ramírez",
      expectedVersion: 1,
      onboardingCompletedAt: "2026-08-08T12:20:00Z",
      phone: "+595981111111",
      userId: ownUser.userId,
    });

    const results = await Promise.allSettled([
      repository.updateOwn({
        displayName: "Luis Alberto Ramírez",
        emailNotificationsEnabled: false,
        expectedVersion: 2,
        phone: "+595981222222",
        updatedAt: "2026-08-08T13:00:00Z",
        userId: ownUser.userId,
      }),
      repository.updateOwn({
        displayName: "Luis A. Ramírez",
        emailNotificationsEnabled: true,
        expectedVersion: 2,
        phone: "+595981333333",
        updatedAt: "2026-08-08T13:00:01Z",
        userId: ownUser.userId,
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "USER_VERSION_CONFLICT" },
      status: "rejected",
    });
    const stored = await repository.findByCognitoSub(ownUser.cognitoSub);
    expect(stored).toMatchObject({
      email: ownUser.email,
      id: ownUser.userId,
      roles: ["STUDENT"],
      status: "PENDING",
      version: 3,
    });
    expect(stored?.phone).not.toBe("+595981111111");
  });
});
