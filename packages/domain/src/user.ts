import type { EntityId } from "@gym-adr/shared";

export const USER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
  "INACTIVE",
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_ROLES = ["STUDENT", "STAFF", "ADMIN"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserProfile {
  readonly id: EntityId;
  readonly createdAt: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly version: number;
}
