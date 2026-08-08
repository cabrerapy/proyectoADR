import type { EntityId } from "@gym-adr/shared";

export interface DomainEntity {
  readonly id: EntityId;
}

export * from "./financial";
export * from "./scheduling";
export * from "./user";
