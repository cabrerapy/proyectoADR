import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuditLogRepository, createDynamoDbAdapter, MembershipPlanRepository, shardForId } from "./index";

const enabled = process.env.DYNAMODB_LOCAL_INTEGRATION === "1";
const tableName = `gym-adr-platform-plans-${Date.now()}`;
const client = new DynamoDBClient({
  credentials: { accessKeyId: "localplaceholder", secretAccessKey: "localplaceholder" },
  endpoint: "http://127.0.0.1:8000",
  region: "local",
});
const adapter = createDynamoDbAdapter({ environment: "local" });
const plans = new MembershipPlanRepository(adapter, tableName);
const audit = new AuditLogRepository(adapter, tableName);

const createInput = {
  actorId: "admin-001",
  auditId: "audit-create-001",
  correlationId: "request-create-001",
  createdAt: "2026-08-09T12:00:00Z",
  currency: "PYG",
  description: "Acceso mensual",
  frequency: "MONTHLY",
  name: "Plan mensual",
  planId: "plan-001",
  price: 250_000,
} as const;

describe.skipIf(!enabled)("TASK-027 membership plans with DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(new CreateTableCommand({
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: [{
        IndexName: "GSI1-Operational",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "KEYS_ONLY" },
      }],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      TableName: tableName,
    }));
  });

  afterAll(async () => {
    if (enabled) await client.send(new DeleteTableCommand({ TableName: tableName }));
    adapter.destroy();
    client.destroy();
  });

  it("creates and lists the canonical plan through the sharded status index without Scan", async () => {
    await expect(plans.create(createInput)).resolves.toMatchObject({
      id: "plan-001",
      status: "ACTIVE",
      version: 1,
    });
    await expect(plans.getById("plan-001", true)).resolves.toMatchObject({ name: "Plan mensual" });
    await expect(plans.list("ACTIVE")).resolves.toMatchObject({
      plans: [{ id: "plan-001", status: "ACTIVE" }],
    });
    await expect(plans.list("INACTIVE")).resolves.toMatchObject({ plans: [] });
  });

  it("allows one concurrent versioned edit, performs logical deletion and preserves audit history", async () => {
    const attempts = await Promise.allSettled([
      plans.update({
        ...createInput,
        auditId: "audit-update-001",
        correlationId: "request-update-001",
        expectedVersion: 1,
        name: "Plan mensual estándar",
        status: "INACTIVE",
        updatedAt: "2026-08-09T12:05:00Z",
      }),
      plans.update({
        ...createInput,
        auditId: "audit-update-002",
        correlationId: "request-update-002",
        expectedVersion: 1,
        name: "Plan mensual alternativo",
        status: "INACTIVE",
        updatedAt: "2026-08-09T12:05:01Z",
      }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const current = await plans.getById("plan-001", true);
    expect(current).toMatchObject({ status: "INACTIVE", version: 2 });
    await expect(plans.list("ACTIVE")).resolves.toMatchObject({ plans: [] });
    await expect(plans.list("INACTIVE")).resolves.toMatchObject({
      plans: [{ id: "plan-001", status: "INACTIVE", version: 2 }],
    });
    const history = await audit.listByEntity(
      "MembershipPlan",
      "plan-001",
      "2026-08-09T00:00:00Z",
      "2026-08-09T23:59:59Z",
    );
    expect(history.entries).toHaveLength(2);
    expect(history.entries.map(({ action }) => action)).toEqual([
      "PLAN_CREATED",
      "PLAN_STATUS_INACTIVE",
    ]);
  });

  it("rejects duplicate creation without duplicating the canonical plan or audit", async () => {
    await expect(plans.create({ ...createInput, auditId: "audit-duplicate-001" }))
      .rejects.toMatchObject({ code: "PLAN_CONFLICT" });
    const history = await audit.listByEntity(
      "MembershipPlan",
      "plan-001",
      "2026-08-09T00:00:00Z",
      "2026-08-09T23:59:59Z",
    );
    expect(history.entries).toHaveLength(2);
  });

  it("paginates every shard once without replaying exhausted partitions", async () => {
    const byShard = new Map<string, string[]>();
    for (let index = 0; index < 20; index += 1) {
      const id = `page-plan-${index}`;
      const values = byShard.get(shardForId(id)) ?? [];
      values.push(id);
      byShard.set(shardForId(id), values);
    }
    const pair = [...byShard.values()].find((values) => values.length >= 2)?.slice(0, 2);
    if (pair === undefined || pair[0] === undefined || pair[1] === undefined) throw new Error("missing shard pair");
    await plans.create({ ...createInput, auditId: "audit-page-001", planId: pair[0], name: "Plan A" });
    await plans.create({ ...createInput, auditId: "audit-page-002", planId: pair[1], name: "Plan B" });
    const first = await plans.list("ACTIVE", { limitPerShard: 1 });
    expect(first.plans).toHaveLength(1);
    expect(first.cursors).toBeDefined();
    const cursors = first.cursors;
    if (cursors === undefined) throw new Error("missing pagination cursor");
    const second = await plans.list("ACTIVE", { cursors, limitPerShard: 1 });
    expect(second.plans).toHaveLength(1);
    expect(new Set([...first.plans, ...second.plans].map(({ id }) => id))).toEqual(new Set(pair));
  });
});
