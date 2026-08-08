import type { EntityId } from "@gym-adr/shared";

export const MEMBERSHIP_STATUSES = [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
  "CUSTOM",
] as const;

export type MembershipFrequency = (typeof MEMBERSHIP_FREQUENCIES)[number];

export interface Membership {
  readonly createdAt: string;
  readonly createdBy: EntityId;
  readonly currency: string;
  readonly endDate: string;
  readonly expectedAmount: number;
  readonly frequency: MembershipFrequency;
  readonly id: EntityId;
  readonly planId: EntityId;
  readonly planName: string;
  readonly startDate: string;
  readonly status: MembershipStatus;
  readonly updatedAt: string;
  readonly userId: EntityId;
  readonly version: number;
}

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "MANUAL_CARD",
  "OTHER",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "VOIDED"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  readonly amount: number;
  readonly createdAt: string;
  readonly currency: string;
  readonly id: EntityId;
  readonly membershipId: EntityId;
  readonly method: PaymentMethod;
  readonly notes?: string;
  readonly paidAt: string;
  readonly paymentDate: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly receiptKey?: string;
  readonly recordedBy: EntityId;
  readonly status: PaymentStatus;
  readonly updatedAt: string;
  readonly userId: EntityId;
  readonly version: number;
}

export type PaymentCorrectionType = "VOID" | "ADJUSTMENT" | "COMPENSATION";

export interface PaymentCorrection {
  readonly actorId: EntityId;
  readonly correctedAt: string;
  readonly id: EntityId;
  readonly originalPaymentId: EntityId;
  readonly reason: string;
  readonly type: PaymentCorrectionType;
  readonly userId: EntityId;
}
