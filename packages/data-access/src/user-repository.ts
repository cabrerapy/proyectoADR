import type { UserProfile, UserRole, UserStatus } from "@gym-adr/domain";
import { USER_ROLES, USER_STATUSES } from "@gym-adr/domain";
import { NumberValue, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { BaseDynamoDbRepository } from "./base-repository";
import type {
  DynamoDbDocumentPort,
  DynamoDbItem,
  DynamoDbKey,
} from "./dynamodb-adapter";
import {
  DynamoDbRepositoryError,
  invalidDynamoDbInput,
  mapDynamoDbError,
} from "./dynamodb-errors";
import { operationalIndexKeys, primaryKeys } from "./model-keys";
import { SHARDS, shardForId, type Shard } from "./model-shards";
import { CURRENT_SCHEMA_VERSION } from "./model-types";
import { assertTimestamp } from "./model-validation";
import {
  normalizeEmail,
  normalizePersonName,
  SearchTokenService,
} from "./search-tokens";

type TransactionAction = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

type FanOutCursors = Readonly<Record<string, DynamoDbKey | undefined>>;

export interface CreatePendingUserInput {
  readonly cognitoSub: string;
  readonly createdAt: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly userId: string;
}

export interface CreatePendingUserResult {
  readonly disposition: "CREATED" | "EXISTING";
  readonly profile: UserProfile;
}

export interface CompletePendingProfileInput {
  readonly displayName: string;
  readonly expectedVersion: number;
  readonly onboardingCompletedAt: string;
  readonly phone: string;
  readonly userId: string;
}

export interface UpdateOwnUserProfileInput {
  readonly displayName: string;
  readonly emailNotificationsEnabled: boolean;
  readonly expectedVersion: number;
  readonly phone: string;
  readonly updatedAt: string;
  readonly userId: string;
}

export interface UpdateUserProfileInput {
  readonly displayName: string;
  readonly email: string;
  readonly emailNotificationsEnabled?: boolean;
  readonly emailVerified: boolean;
  readonly expectedVersion: number;
  readonly phone?: string;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly userId: string;
}

export interface UserPage {
  readonly cursors?: FanOutCursors;
  readonly profiles: readonly UserProfile[];
}

interface UserProfileItem extends DynamoDbItem {
  readonly GSI1PK: string;
  readonly GSI1SK: string;
  readonly createdAt: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailNotificationsEnabled?: boolean;
  readonly emailVerified: boolean;
  readonly entityType: "UserProfile";
  readonly onboardingCompletedAt?: string;
  readonly phone?: string;
  readonly roles: readonly UserRole[];
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly searchTokenVersions: readonly string[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly userId: string;
  readonly version: number;
}

interface LookupRecord {
  readonly key: { readonly PK: string; readonly SK: string };
  readonly lookupType: "EMAIL" | "NAME";
  readonly tokenVersion: string;
}

const tableNamePattern = /^[A-Za-z0-9_.-]{3,255}$/u;

const userError = (
  code:
    | "USER_EMAIL_CONFLICT"
    | "USER_ONBOARDING_INCOMPLETE"
    | "USER_ONBOARDING_COMPLETE"
    | "USER_RECORD_INVALID"
    | "USER_STATUS_INVALID"
    | "USER_VERSION_CONFLICT",
  message: string,
): DynamoDbRepositoryError => new DynamoDbRepositoryError(code, message);

const assertTableName = (value: string): string => {
  if (!tableNamePattern.test(value)) {
    throw invalidDynamoDbInput("El nombre de tabla DynamoDB no es válido.");
  }
  return value;
};

const timestamp = (value: string, label: string): string => {
  try {
    const result = assertTimestamp(value, label);
    if (!Number.isFinite(Date.parse(result))) {
      throw new Error("invalid timestamp");
    }
    return result;
  } catch {
    throw invalidDynamoDbInput(`${label} debe ser un timestamp UTC válido.`);
  }
};

const isStatus = (value: unknown): value is UserStatus =>
  typeof value === "string" && USER_STATUSES.some((status) => status === value);

const isRole = (value: unknown): value is UserRole =>
  typeof value === "string" && USER_ROLES.some((role) => role === value);

const roles = (value: readonly UserRole[]): readonly UserRole[] => {
  if (
    value.length < 1 ||
    value.length > USER_ROLES.length ||
    value.some((role) => !isRole(role)) ||
    new Set(value).size !== value.length
  ) {
    throw invalidDynamoDbInput("Los roles del usuario no son válidos.");
  }
  return [...value].sort();
};

const storedDisplayName = (value: string): string => {
  normalizePersonName(value);
  return value.trim().normalize("NFKC").replace(/\s+/gu, " ");
};

const storedPhone = (value: string): string => {
  const normalized = value.trim().normalize("NFKC");
  if (!/^\+[1-9]\d{7,14}$/u.test(normalized)) {
    throw invalidDynamoDbInput("El teléfono del perfil no es válido.");
  }
  return normalized;
};

const verifiedEmail = (value: string, verified: boolean): string => {
  if (verified !== true) {
    throw invalidDynamoDbInput(
      "El perfil requiere un correo verificado por el proveedor de identidad.",
    );
  }
  return normalizeEmail(value);
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof NumberValue) {
    const parsed = Number(value.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const itemKey = (item: DynamoDbItem): { readonly PK: string; readonly SK: string } => {
  if (typeof item.PK !== "string" || typeof item.SK !== "string") {
    throw userError("USER_RECORD_INVALID", "La referencia de usuario persistida no es válida.");
  }
  return { PK: item.PK, SK: item.SK };
};

const profileOrder = (left: UserProfile, right: UserProfile): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

const lookupId = (record: LookupRecord): string =>
  `${record.key.PK}\u0000${record.key.SK}`;

const hasCursors = (cursors: FanOutCursors): boolean =>
  Object.values(cursors).some((cursor) => cursor !== undefined);

export class UserRepository {
  private readonly base: BaseDynamoDbRepository;
  private readonly tableName: string;

  constructor(
    private readonly document: DynamoDbDocumentPort,
    tableName: string,
    private readonly searchTokens: SearchTokenService,
  ) {
    this.tableName = assertTableName(tableName);
    this.base = new BaseDynamoDbRepository(document, { tableName });
  }

  async createPending(input: CreatePendingUserInput): Promise<CreatePendingUserResult> {
    const createdAt = timestamp(input.createdAt, "createdAt");
    const email = verifiedEmail(input.email, input.emailVerified);
    const displayName = storedDisplayName(input.displayName);
    const profileKey = this.safeProfileKey(input.userId);
    const authKey = this.safeAuthKey(input.cognitoSub);
    const index = operationalIndexKeys.userStatus(
      "PENDING",
      shardForId(input.userId),
      createdAt,
      input.userId,
    );
    const profileItem: UserProfileItem = {
      ...profileKey,
      GSI1PK: index.PK,
      GSI1SK: index.SK,
      createdAt,
      displayName,
      email,
      emailNotificationsEnabled: true,
      emailVerified: true,
      entityType: "UserProfile",
      roles: ["STUDENT"],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      searchTokenVersions: this.searchTokens.versions,
      status: "PENDING",
      updatedAt: createdAt,
      userId: input.userId,
      version: 1,
    };
    const actions: TransactionAction[] = [
      this.createPut(profileItem),
      this.createPut({
        ...authKey,
        createdAt,
        entityType: "AuthMapping",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: createdAt,
        userId: input.userId,
      }),
      ...this.lookupRecords(email, displayName, input.userId).map((record) =>
        this.createLookupPut(record, input.userId, createdAt)
      ),
    ];
    this.assertTransactionSize(actions);

    try {
      await this.document.transactWrite({ TransactItems: actions });
      return { disposition: "CREATED", profile: this.toDomain(profileItem) };
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code !== "TRANSACTION_CANCELLED" &&
        mapped.code !== "CONDITIONAL_CHECK_FAILED"
      ) {
        throw mapped;
      }

      const existing = await this.findByCognitoSub(input.cognitoSub);
      if (existing !== undefined) {
        return { disposition: "EXISTING", profile: existing };
      }
      if (await this.findByEmail(email) !== undefined) {
        throw userError(
          "USER_EMAIL_CONFLICT",
          "El correo verificado ya pertenece a otro perfil.",
        );
      }
      throw mapped;
    }
  }

  async completePendingProfile(
    input: CompletePendingProfileInput,
  ): Promise<UserProfile> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw invalidDynamoDbInput("La versión esperada del perfil no es válida.");
    }
    const key = this.safeProfileKey(input.userId);
    const currentItem = await this.base.get(key, true);
    if (currentItem === undefined) {
      throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "El perfil solicitado no existe.");
    }
    const current = this.readProfileItem(currentItem, key);
    const displayName = storedDisplayName(input.displayName);
    const phone = storedPhone(input.phone);

    if (current.onboardingCompletedAt !== undefined) {
      if (current.displayName === displayName && current.phone === phone) {
        return this.toDomain(current);
      }
      throw userError("USER_ONBOARDING_COMPLETE", "El perfil inicial ya fue completado.");
    }
    if (current.status !== "PENDING") {
      throw userError("USER_STATUS_INVALID", "El estado del usuario no permite completar el perfil.");
    }
    if (current.version !== input.expectedVersion) {
      throw userError("USER_VERSION_CONFLICT", "El perfil fue modificado por otra operación.");
    }
    const completedAt = timestamp(input.onboardingCompletedAt, "onboardingCompletedAt");
    if (completedAt < current.updatedAt) {
      throw invalidDynamoDbInput("onboardingCompletedAt no puede ser anterior al perfil vigente.");
    }
    const nextVersion = input.expectedVersion + 1;
    if (!Number.isSafeInteger(nextVersion)) {
      throw invalidDynamoDbInput("La versión siguiente del perfil no es válida.");
    }
    this.searchTokens.assertVersionsAvailable(current.searchTokenVersions);
    const previousLookups = new Map(
      this.lookupRecords(
        current.email,
        current.displayName,
        input.userId,
        current.searchTokenVersions,
      ).map((record) => [lookupId(record), record]),
    );
    const desiredLookups = new Map(
      this.lookupRecords(current.email, displayName, input.userId).map((record) => [
        lookupId(record),
        record,
      ]),
    );
    const actions: TransactionAction[] = [
      {
        Update: {
          ConditionExpression:
            "attribute_exists(#pk) AND #version = :expectedVersion AND #status = :pending AND attribute_not_exists(#completedAt)",
          ExpressionAttributeNames: {
            "#completedAt": "onboardingCompletedAt",
            "#displayName": "displayName",
            "#phone": "phone",
            "#pk": "PK",
            "#searchTokenVersions": "searchTokenVersions",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":completedAt": completedAt,
            ":displayName": displayName,
            ":expectedVersion": input.expectedVersion,
            ":nextVersion": nextVersion,
            ":pending": "PENDING",
            ":phone": phone,
            ":searchTokenVersions": this.searchTokens.versions,
            ":updatedAt": completedAt,
          },
          Key: key,
          TableName: this.tableName,
          UpdateExpression:
            "SET #displayName = :displayName, #phone = :phone, #completedAt = :completedAt, #updatedAt = :updatedAt, #version = :nextVersion, #searchTokenVersions = :searchTokenVersions",
        },
      },
      ...[...previousLookups]
        .filter(([id]) => !desiredLookups.has(id))
        .map(([, record]) => this.createLookupDelete(record, input.userId)),
      ...[...desiredLookups.values()].map((record) =>
        this.createLookupUpsert(record, input.userId, completedAt)
      ),
    ];
    this.assertTransactionSize(actions);

    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (mapped.code === "TRANSACTION_CANCELLED" || mapped.code === "CONDITIONAL_CHECK_FAILED") {
        const latest = await this.getById(input.userId, true);
        if (latest === undefined) {
          throw new DynamoDbRepositoryError("RESOURCE_NOT_FOUND", "El perfil solicitado no existe.");
        }
        if (
          latest.onboardingCompletedAt !== undefined &&
          latest.displayName === displayName &&
          latest.phone === phone
        ) return latest;
        if (latest.onboardingCompletedAt !== undefined) {
          throw userError("USER_ONBOARDING_COMPLETE", "El perfil inicial ya fue completado.");
        }
        if (latest.status !== "PENDING") {
          throw userError("USER_STATUS_INVALID", "El estado del usuario no permite completar el perfil.");
        }
        if (latest.version !== input.expectedVersion) {
          throw userError("USER_VERSION_CONFLICT", "El perfil fue modificado por otra operación.");
        }
      }
      throw mapped;
    }

    return this.toDomain({
      ...current,
      displayName,
      onboardingCompletedAt: completedAt,
      phone,
      searchTokenVersions: this.searchTokens.versions,
      updatedAt: completedAt,
      version: nextVersion,
    });
  }

  async updateOwn(input: UpdateOwnUserProfileInput): Promise<UserProfile> {
    const current = await this.getById(input.userId, true);
    if (current === undefined) {
      throw new DynamoDbRepositoryError(
        "RESOURCE_NOT_FOUND",
        "El perfil solicitado no existe.",
      );
    }
    if (current.onboardingCompletedAt === undefined || current.phone === undefined) {
      throw userError(
        "USER_ONBOARDING_INCOMPLETE",
        "El perfil inicial debe completarse antes de editarlo.",
      );
    }

    return this.update({
      displayName: input.displayName,
      email: current.email,
      emailNotificationsEnabled: input.emailNotificationsEnabled,
      emailVerified: current.emailVerified,
      expectedVersion: input.expectedVersion,
      phone: input.phone,
      roles: current.roles,
      status: current.status,
      updatedAt: input.updatedAt,
      userId: input.userId,
    });
  }

  destroy(): void {
    this.base.destroy();
  }

  async findByCognitoSub(cognitoSub: string): Promise<UserProfile | undefined> {
    const key = this.safeAuthKey(cognitoSub);
    const mapping = await this.base.get(key, true);
    if (mapping === undefined) {
      return undefined;
    }
    const userId = this.readOwner(mapping, key, "AuthMapping");
    const profile = await this.getById(userId, true);
    if (profile === undefined) {
      throw userError(
        "USER_RECORD_INVALID",
        "El mapeo de identidad no tiene un perfil canónico asociado.",
      );
    }
    return profile;
  }

  async findByEmail(email: string): Promise<UserProfile | undefined> {
    const owners = new Set<string>();
    for (const entry of this.searchTokens.emailTokens(email)) {
      const key = primaryKeys.emailLookup(entry.version, entry.token);
      const item = await this.base.get(key, true);
      if (item !== undefined) {
        owners.add(this.readOwner(item, key, "Lookup"));
      }
    }
    if (owners.size === 0) {
      return undefined;
    }
    if (owners.size !== 1) {
      throw userError(
        "USER_RECORD_INVALID",
        "Las versiones de búsqueda por correo no tienen un propietario único.",
      );
    }
    const [userId] = owners;
    if (userId === undefined) {
      throw userError("USER_RECORD_INVALID", "El lookup de correo no es válido.");
    }
    const profile = await this.getById(userId, true);
    if (profile === undefined) {
      throw userError(
        "USER_RECORD_INVALID",
        "El lookup de correo no tiene un perfil canónico asociado.",
      );
    }
    return profile;
  }

  async getById(userId: string, consistentRead = true): Promise<UserProfile | undefined> {
    const key = this.safeProfileKey(userId);
    const item = await this.base.get(key, consistentRead);
    return item === undefined ? undefined : this.readProfile(item, key);
  }

  async listByStatus(
    status: UserStatus,
    options: { readonly cursors?: FanOutCursors; readonly limitPerShard?: number } = {},
  ): Promise<UserPage> {
    if (!isStatus(status)) {
      throw invalidDynamoDbInput("El estado de usuario no es válido.");
    }
    const limit = options.limitPerShard ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw invalidDynamoDbInput("El límite por shard debe estar entre 1 y 25.");
    }
    const pages = await Promise.all(
      SHARDS.map(async (shard) => ({
        page: await this.base.queryPage({
          ...(options.cursors?.[shard] === undefined
            ? {}
            : { cursor: options.cursors[shard] }),
          indexName: "GSI1-Operational",
          limit,
          partitionValue: `USER_STATUS#${status}#${shard}`,
        }),
        shard,
      })),
    );
    const profiles = await this.readProfiles(
      pages.flatMap(({ page }) => page.items.map(itemKey)),
      false,
    );
    const cursors = Object.fromEntries(
      pages.map(({ page, shard }) => [shard, page.nextCursor]),
    ) as FanOutCursors;
    return {
      ...(hasCursors(cursors) ? { cursors } : {}),
      profiles: profiles.sort(profileOrder),
    };
  }

  async searchByName(
    prefix: string,
    options: { readonly cursors?: FanOutCursors; readonly limitPerPartition?: number } = {},
  ): Promise<UserPage> {
    const limit = options.limitPerPartition ?? 12;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) {
      throw invalidDynamoDbInput(
        "El límite por partición de nombre debe estar entre 1 y 12.",
      );
    }
    const searches = this.searchTokens.nameSearchTokens(prefix).flatMap((entry) =>
      SHARDS.map((shard) => ({ ...entry, shard }))
    );
    const pages = await Promise.all(
      searches.map(async ({ shard, token, version }) => {
        const cursorKey = `${version}:${shard}`;
        const partition = primaryKeys.nameLookup(
          version,
          token,
          shard,
          "cursor-placeholder",
        ).PK;
        return {
          cursorKey,
          page: await this.base.queryPage({
            consistentRead: true,
            ...(options.cursors?.[cursorKey] === undefined
              ? {}
              : { cursor: options.cursors[cursorKey] }),
            limit,
            partitionValue: partition,
            sortKey: { operation: "BEGINS_WITH", value: "USER#" },
          }),
        };
      }),
    );
    const userIds = new Set<string>();
    for (const { page } of pages) {
      for (const item of page.items) {
        const key = itemKey(item);
        userIds.add(this.readOwner(item, key, "Lookup"));
      }
    }
    const profiles = await this.readProfiles(
      [...userIds].map((userId) => this.safeProfileKey(userId)),
      true,
    );
    const cursors = Object.fromEntries(
      pages.map(({ cursorKey, page }) => [cursorKey, page.nextCursor]),
    ) as FanOutCursors;
    return {
      ...(hasCursors(cursors) ? { cursors } : {}),
      profiles: profiles.sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "es") ||
        left.id.localeCompare(right.id)
      ),
    };
  }

  async update(input: UpdateUserProfileInput): Promise<UserProfile> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw invalidDynamoDbInput("La versión esperada del perfil no es válida.");
    }
    if (!isStatus(input.status)) {
      throw invalidDynamoDbInput("El estado de usuario no es válido.");
    }
    const currentItem = await this.base.get(this.safeProfileKey(input.userId), true);
    if (currentItem === undefined) {
      throw new DynamoDbRepositoryError(
        "RESOURCE_NOT_FOUND",
        "El perfil solicitado no existe.",
      );
    }
    const current = this.readProfileItem(currentItem, this.safeProfileKey(input.userId));
    if (current.version !== input.expectedVersion) {
      throw userError(
        "USER_VERSION_CONFLICT",
        "El perfil fue modificado por otra operación.",
      );
    }
    const updatedAt = timestamp(input.updatedAt, "updatedAt");
    if (updatedAt < current.updatedAt) {
      throw invalidDynamoDbInput("updatedAt no puede ser anterior al perfil vigente.");
    }
    const email = verifiedEmail(input.email, input.emailVerified);
    const displayName = storedDisplayName(input.displayName);
    const emailNotificationsEnabled = input.emailNotificationsEnabled ??
      current.emailNotificationsEnabled ?? true;
    const phone = input.phone === undefined ? current.phone : storedPhone(input.phone);
    const nextRoles = roles(input.roles);
    const nextVersion = input.expectedVersion + 1;
    if (!Number.isSafeInteger(nextVersion)) {
      throw invalidDynamoDbInput("La versión siguiente del perfil no es válida.");
    }
    this.searchTokens.assertVersionsAvailable(current.searchTokenVersions);
    const previousLookups = new Map(
      this.lookupRecords(
        current.email,
        current.displayName,
        input.userId,
        current.searchTokenVersions,
      ).map((record) => [lookupId(record), record]),
    );
    const desiredLookups = new Map(
      this.lookupRecords(email, displayName, input.userId).map((record) => [
        lookupId(record),
        record,
      ]),
    );
    const index = operationalIndexKeys.userStatus(
      input.status,
      shardForId(input.userId),
      current.createdAt,
      input.userId,
    );
    const actions: TransactionAction[] = [
      {
        Update: {
          ConditionExpression: "attribute_exists(#pk) AND #version = :expectedVersion",
          ExpressionAttributeNames: {
            "#displayName": "displayName",
            "#email": "email",
            "#emailNotificationsEnabled": "emailNotificationsEnabled",
            "#emailVerified": "emailVerified",
            "#gsi1pk": "GSI1PK",
            "#gsi1sk": "GSI1SK",
            "#pk": "PK",
            "#roles": "roles",
            "#searchTokenVersions": "searchTokenVersions",
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#version": "version",
            ...(phone === undefined ? {} : { "#phone": "phone" }),
          },
          ExpressionAttributeValues: {
            ":displayName": displayName,
            ":email": email,
            ":emailNotificationsEnabled": emailNotificationsEnabled,
            ":emailVerified": true,
            ":expectedVersion": input.expectedVersion,
            ":gsi1pk": index.PK,
            ":gsi1sk": index.SK,
            ":nextVersion": nextVersion,
            ":roles": nextRoles,
            ":searchTokenVersions": this.searchTokens.versions,
            ":status": input.status,
            ":updatedAt": updatedAt,
            ...(phone === undefined ? {} : { ":phone": phone }),
          },
          Key: this.safeProfileKey(input.userId),
          TableName: this.tableName,
          UpdateExpression:
            `SET #displayName = :displayName, #email = :email, #emailNotificationsEnabled = :emailNotificationsEnabled, #emailVerified = :emailVerified, #roles = :roles, #status = :status, #updatedAt = :updatedAt, #version = :nextVersion, #searchTokenVersions = :searchTokenVersions, #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk${phone === undefined ? "" : ", #phone = :phone"}`,
        },
      },
      ...[...previousLookups]
        .filter(([id]) => !desiredLookups.has(id))
        .map(([, record]) => this.createLookupDelete(record, input.userId)),
      ...[...desiredLookups.values()].map((record) =>
        this.createLookupUpsert(record, input.userId, updatedAt)
      ),
    ];
    this.assertTransactionSize(actions);

    try {
      await this.document.transactWrite({ TransactItems: actions });
    } catch (error) {
      const mapped = mapDynamoDbError(error);
      if (
        mapped.code === "TRANSACTION_CANCELLED" ||
        mapped.code === "CONDITIONAL_CHECK_FAILED"
      ) {
        const owner = await this.findByEmail(email);
        if (owner !== undefined && owner.id !== input.userId) {
          throw userError(
            "USER_EMAIL_CONFLICT",
            "El correo verificado ya pertenece a otro perfil.",
          );
        }
        const latest = await this.getById(input.userId, true);
        if (latest === undefined) {
          throw new DynamoDbRepositoryError(
            "RESOURCE_NOT_FOUND",
            "El perfil solicitado no existe.",
          );
        }
        if (latest.version !== input.expectedVersion) {
          throw userError(
            "USER_VERSION_CONFLICT",
            "El perfil fue modificado por otra operación.",
          );
        }
      }
      throw mapped;
    }

    return {
      createdAt: current.createdAt,
      displayName,
      email,
      emailNotificationsEnabled,
      emailVerified: true,
      id: input.userId,
      ...(current.onboardingCompletedAt === undefined
        ? {}
        : { onboardingCompletedAt: current.onboardingCompletedAt }),
      ...(phone === undefined ? {} : { phone }),
      roles: nextRoles,
      status: input.status,
      updatedAt,
      version: nextVersion,
    };
  }

  private assertTransactionSize(actions: readonly TransactionAction[]): void {
    if (actions.length < 1 || actions.length > 100) {
      throw invalidDynamoDbInput(
        "La actualización de perfil excede el límite transaccional de DynamoDB.",
      );
    }
  }

  private createLookupDelete(record: LookupRecord, userId: string): TransactionAction {
    return {
      Delete: {
        ConditionExpression: "#owner = :owner",
        ExpressionAttributeNames: { "#owner": "userId" },
        ExpressionAttributeValues: { ":owner": userId },
        Key: record.key,
        TableName: this.tableName,
      },
    };
  }

  private createLookupPut(
    record: LookupRecord,
    userId: string,
    createdAt: string,
  ): TransactionAction {
    return this.createPut({
      ...record.key,
      createdAt,
      entityType: "Lookup",
      lookupType: record.lookupType,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tokenVersion: record.tokenVersion,
      updatedAt: createdAt,
      userId,
    });
  }

  private createLookupUpsert(
    record: LookupRecord,
    userId: string,
    updatedAt: string,
  ): TransactionAction {
    return {
      Update: {
        ConditionExpression: "attribute_not_exists(#owner) OR #owner = :owner",
        ExpressionAttributeNames: {
          "#createdAt": "createdAt",
          "#entityType": "entityType",
          "#lookupType": "lookupType",
          "#owner": "userId",
          "#schemaVersion": "schemaVersion",
          "#tokenVersion": "tokenVersion",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":entityType": "Lookup",
          ":lookupType": record.lookupType,
          ":owner": userId,
          ":schemaVersion": CURRENT_SCHEMA_VERSION,
          ":tokenVersion": record.tokenVersion,
          ":updatedAt": updatedAt,
        },
        Key: record.key,
        TableName: this.tableName,
        UpdateExpression:
          "SET #owner = :owner, #entityType = :entityType, #schemaVersion = :schemaVersion, #lookupType = :lookupType, #tokenVersion = :tokenVersion, #createdAt = if_not_exists(#createdAt, :updatedAt), #updatedAt = :updatedAt",
      },
    };
  }

  private createPut(item: DynamoDbItem): TransactionAction {
    return {
      Put: {
        ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        Item: item,
        TableName: this.tableName,
      },
    };
  }

  private lookupRecords(
    email: string,
    displayName: string,
    userId: string,
    versions = this.searchTokens.versions,
  ): readonly LookupRecord[] {
    return [
      ...this.searchTokens.emailTokens(email, versions).map(({ token, version }) => ({
        key: primaryKeys.emailLookup(version, token),
        lookupType: "EMAIL" as const,
        tokenVersion: version,
      })),
      ...this.searchTokens.namePrefixTokens(displayName, versions).map(
        ({ token, version }) => ({
          key: primaryKeys.nameLookup(
            version,
            token,
            shardForId(userId),
            userId,
          ),
          lookupType: "NAME" as const,
          tokenVersion: version,
        }),
      ),
    ];
  }

  private async readProfiles(
    keys: readonly { readonly PK: string; readonly SK: string }[],
    consistentRead: boolean,
  ): Promise<UserProfile[]> {
    const unique = [...new Map(keys.map((key) => [`${key.PK}\u0000${key.SK}`, key])).values()];
    const profiles: UserProfile[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      if (batch.length === 0) {
        continue;
      }
      const items = await this.base.batchGet(batch, consistentRead);
      profiles.push(...items.map((item) => this.readProfile(item, itemKey(item))));
    }
    return profiles;
  }

  private readOwner(
    item: DynamoDbItem,
    expectedKey: { readonly PK: string; readonly SK: string },
    entityType: "AuthMapping" | "Lookup",
  ): string {
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== entityType ||
      numberValue(item.schemaVersion) !== CURRENT_SCHEMA_VERSION ||
      typeof item.userId !== "string"
    ) {
      throw userError(
        "USER_RECORD_INVALID",
        "La referencia de usuario persistida no es válida.",
      );
    }
    this.safeProfileKey(item.userId);
    return item.userId;
  }

  private readProfile(
    item: DynamoDbItem,
    expectedKey: { readonly PK: string; readonly SK: string },
  ): UserProfile {
    return this.toDomain(this.readProfileItem(item, expectedKey));
  }

  private readProfileItem(
    item: DynamoDbItem,
    expectedKey: { readonly PK: string; readonly SK: string },
  ): UserProfileItem {
    const version = numberValue(item.version);
    const schemaVersion = numberValue(item.schemaVersion);
    if (
      item.PK !== expectedKey.PK ||
      item.SK !== expectedKey.SK ||
      item.entityType !== "UserProfile" ||
      schemaVersion !== CURRENT_SCHEMA_VERSION ||
      typeof item.userId !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      typeof item.displayName !== "string" ||
      typeof item.email !== "string" ||
      (item.emailNotificationsEnabled !== undefined &&
        typeof item.emailNotificationsEnabled !== "boolean") ||
      item.emailVerified !== true ||
      (item.onboardingCompletedAt !== undefined && typeof item.onboardingCompletedAt !== "string") ||
      (item.phone !== undefined && typeof item.phone !== "string") ||
      ((item.onboardingCompletedAt === undefined) !== (item.phone === undefined)) ||
      !isStatus(item.status) ||
      !Array.isArray(item.roles) ||
      item.roles.some((role) => !isRole(role)) ||
      !Array.isArray(item.searchTokenVersions) ||
      item.searchTokenVersions.some((entry) => typeof entry !== "string") ||
      typeof item.GSI1PK !== "string" ||
      typeof item.GSI1SK !== "string" ||
      version === undefined ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw userError("USER_RECORD_INVALID", "El perfil persistido no es válido.");
    }
    try {
      this.safeProfileKey(item.userId);
      timestamp(item.createdAt, "createdAt");
      timestamp(item.updatedAt, "updatedAt");
      verifiedEmail(item.email, item.emailVerified);
      storedDisplayName(item.displayName);
      if (item.phone !== undefined) storedPhone(item.phone);
      if (item.onboardingCompletedAt !== undefined) {
        timestamp(item.onboardingCompletedAt, "onboardingCompletedAt");
      }
      const validRoles = roles(item.roles.filter(isRole));
      const tokenVersions = item.searchTokenVersions.filter(
        (entry): entry is string => typeof entry === "string",
      );
      this.searchTokens.assertVersionsAvailable(tokenVersions);
      const expectedIndex = operationalIndexKeys.userStatus(
        item.status,
        shardForId(item.userId),
        item.createdAt,
        item.userId,
      );
      if (item.GSI1PK !== expectedIndex.PK || item.GSI1SK !== expectedIndex.SK) {
        throw new Error("invalid index");
      }
      return {
        PK: item.PK,
        SK: item.SK,
        GSI1PK: item.GSI1PK,
        GSI1SK: item.GSI1SK,
        createdAt: item.createdAt,
        displayName: item.displayName,
        email: item.email,
        emailNotificationsEnabled: item.emailNotificationsEnabled ?? true,
        emailVerified: true,
        entityType: "UserProfile",
        ...(item.onboardingCompletedAt === undefined
          ? {}
          : { onboardingCompletedAt: item.onboardingCompletedAt }),
        ...(item.phone === undefined ? {} : { phone: item.phone }),
        roles: validRoles,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        searchTokenVersions: tokenVersions,
        status: item.status,
        updatedAt: item.updatedAt,
        userId: item.userId,
        version,
      };
    } catch (error) {
      if (
        error instanceof DynamoDbRepositoryError &&
        error.code === "USER_RECORD_INVALID"
      ) {
        throw error;
      }
      throw userError("USER_RECORD_INVALID", "El perfil persistido no es válido.");
    }
  }

  private safeAuthKey(cognitoSub: string): { readonly PK: string; readonly SK: string } {
    try {
      return primaryKeys.authMapping(cognitoSub);
    } catch {
      throw invalidDynamoDbInput("El identificador de Cognito no es válido.");
    }
  }

  private safeProfileKey(userId: string): { readonly PK: string; readonly SK: string } {
    try {
      return primaryKeys.userProfile(userId);
    } catch {
      throw invalidDynamoDbInput("El identificador de usuario no es válido.");
    }
  }

  private toDomain(item: UserProfileItem): UserProfile {
    return {
      createdAt: item.createdAt,
      displayName: item.displayName,
      email: item.email,
      emailNotificationsEnabled: item.emailNotificationsEnabled ?? true,
      emailVerified: item.emailVerified,
      id: item.userId,
      ...(item.onboardingCompletedAt === undefined
        ? {}
        : { onboardingCompletedAt: item.onboardingCompletedAt }),
      ...(item.phone === undefined ? {} : { phone: item.phone }),
      roles: item.roles,
      status: item.status,
      updatedAt: item.updatedAt,
      version: item.version,
    };
  }
}
