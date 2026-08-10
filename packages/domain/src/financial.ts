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

export const MEMBERSHIP_PLAN_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type MembershipPlanStatus = (typeof MEMBERSHIP_PLAN_STATUSES)[number];

export interface MembershipPlan {
  readonly createdAt: string;
  readonly createdBy: EntityId;
  readonly currency: string;
  readonly description?: string;
  readonly frequency: MembershipFrequency;
  readonly id: EntityId;
  readonly name: string;
  readonly price: number;
  readonly status: MembershipPlanStatus;
  readonly updatedAt: string;
  readonly updatedBy: EntityId;
  readonly version: number;
}

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

export const MEMBERSHIP_STATUS_TRANSITIONS = {
  ACTIVE: ["SUSPENDED", "EXPIRED", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: [],
  PENDING: ["ACTIVE", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "EXPIRED", "CANCELLED"],
} as const satisfies Readonly<Record<MembershipStatus, readonly MembershipStatus[]>>;

export type MembershipStanding = "UPCOMING" | "CURRENT" | "OVERDUE" | "INACTIVE";

export const canTransitionMembership = (
  from: MembershipStatus,
  to: MembershipStatus,
): boolean => MEMBERSHIP_STATUS_TRANSITIONS[from].some((candidate) => candidate === to);

export const localCalendarDate = (
  instant: Date,
  timeZone = "America/Asuncion",
): string => {
  if (Number.isNaN(instant.getTime())) throw new RangeError("El instante no es válido.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (value.year === undefined || value.month === undefined || value.day === undefined) {
    throw new RangeError("No fue posible calcular la fecha local.");
  }
  return `${value.year}-${value.month}-${value.day}`;
};

export const membershipStanding = (
  membership: Pick<Membership, "endDate" | "startDate" | "status">,
  instant: Date,
  timeZone = "America/Asuncion",
): MembershipStanding => {
  if (membership.status !== "ACTIVE") return "INACTIVE";
  const today = localCalendarDate(instant, timeZone);
  if (today < membership.startDate) return "UPCOMING";
  return today <= membership.endDate ? "CURRENT" : "OVERDUE";
};

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
  readonly correctionType?: "ADJUSTMENT" | "COMPENSATION";
  readonly id: EntityId;
  readonly membershipId: EntityId;
  readonly method: PaymentMethod;
  readonly notes?: string;
  readonly paidAt: string;
  readonly paymentDate: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly originalPaymentId?: EntityId;
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
  readonly relatedPaymentId?: EntityId;
  readonly type: PaymentCorrectionType;
  readonly userId: EntityId;
}
