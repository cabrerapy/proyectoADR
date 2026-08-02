import type { DomainEntity } from "@gym-adr/domain";
import type { EntityId } from "@gym-adr/shared";

export interface EntityReader<T extends DomainEntity> {
  findById(id: EntityId): Promise<T | undefined>;
}
