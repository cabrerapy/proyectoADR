import type { EntityId } from "@gym-adr/shared";

export const USER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
  "INACTIVE",
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_TRANSITIONS = {
  ACTIVE: ["SUSPENDED", "INACTIVE"],
  INACTIVE: ["ACTIVE"],
  PENDING: ["ACTIVE", "REJECTED"],
  REJECTED: [],
  SUSPENDED: ["ACTIVE", "INACTIVE"],
} as const satisfies Readonly<Record<UserStatus, readonly UserStatus[]>>;

export const canTransitionUserStatus = (
  current: UserStatus,
  next: UserStatus,
): boolean => USER_STATUS_TRANSITIONS[current].some((status) => status === next);

export const USER_ROLES = ["STUDENT", "STAFF", "ADMIN"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserProfile {
  readonly id: EntityId;
  readonly createdAt: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailNotificationsEnabled?: boolean;
  readonly emailVerified: boolean;
  readonly onboardingCompletedAt?: string;
  readonly phone?: string;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly updatedAt: string;
  readonly version: number;
}
