import type { DomainEntity } from "@gym-adr/domain";
import type { EntityId } from "@gym-adr/shared";

export * from "./base-repository";
export * from "./class-session-repository";
export * from "./dynamodb-adapter";
export * from "./dynamodb-config";
export * from "./dynamodb-errors";
export * from "./idempotency-repository";
export * from "./membership-repository";
export * from "./model-codecs";
export * from "./model-keys";
export * from "./model-shards";
export * from "./model-types";
export * from "./model-validation";
export * from "./payment-repository";
export * from "./reservation-repository";
export * from "./search-tokens";
export * from "./user-repository";

export interface EntityReader<T extends DomainEntity> {
  findById(id: EntityId): Promise<T | undefined>;
}
