export const FIXTURE_NOW = "2026-08-15T12:00:00Z";
export const FIXTURE_DATE = "2026-08-15";

export const repositoryFixtureIds = (suffix = "001") => ({
  auditId: `audit-${suffix}`,
  classId: `class-${suffix}`,
  correlationId: `correlation-${suffix}`,
  membershipId: `membership-${suffix}`,
  paymentId: `payment-${suffix}`,
  planId: `plan-${suffix}`,
  requestKey: `request-${suffix}`,
  reservationId: `reservation-${suffix}`,
  userId: `student-${suffix}`,
} as const);

export const activeStudentFixture = (suffix = "001") => ({
  createdAt: FIXTURE_NOW,
  email: `student-${suffix}@example.invalid`,
  id: `student-${suffix}`,
  roles: ["STUDENT"] as const,
  status: "ACTIVE" as const,
  updatedAt: FIXTURE_NOW,
});

export const activeMembershipFixture = (suffix = "001") => ({
  createdAt: FIXTURE_NOW,
  currency: "PYG" as const,
  endDate: "2026-09-15",
  expectedAmount: 250_000,
  frequency: "MONTHLY" as const,
  id: `membership-${suffix}`,
  planId: `plan-${suffix}`,
  startDate: FIXTURE_DATE,
  status: "ACTIVE" as const,
  updatedAt: FIXTURE_NOW,
  userId: `student-${suffix}`,
});
