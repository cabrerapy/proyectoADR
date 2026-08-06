import type { DomainEntity } from "@gym-adr/domain";
import type { EntityId } from "@gym-adr/shared";

export * from "./model-codecs";
export * from "./model-keys";
export * from "./model-shards";
export * from "./model-types";
export * from "./model-validation";

export interface EntityReader<T extends DomainEntity> {
  findById(id: EntityId): Promise<T | undefined>;
}
