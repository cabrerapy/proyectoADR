import type { EntityId } from "@gym-adr/shared";

export const CLASS_SESSION_STATUSES = [
  "SCHEDULED",
  "CANCELLED",
  "COMPLETED",
] as const;

export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

export interface ClassSession {
  readonly capacity: number;
  readonly classDate: string;
  readonly classTypeId: EntityId;
  readonly classTypeName: string;
  readonly confirmedCount: number;
  readonly createdAt: string;
  readonly createdBy: EntityId;
  readonly endsAt: string;
  readonly id: EntityId;
  readonly startTime: string;
  readonly startsAt: string;
  readonly status: ClassSessionStatus;
  readonly trainerId: EntityId;
  readonly trainerName: string;
  readonly updatedAt: string;
  readonly version: number;
}

export const RESERVATION_STATUSES = [
  "CONFIRMED",
  "CANCELLED",
  "ADMIN_CANCELLED",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface Reservation {
  readonly classId: EntityId;
  readonly createdAt: string;
  readonly id: EntityId;
  readonly startsAt: string;
  readonly status: ReservationStatus;
  readonly studentId: EntityId;
  readonly updatedAt: string;
  readonly version: number;
}
