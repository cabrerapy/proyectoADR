import { describe, expect, it } from "vitest";

import {
  canTransitionMembership,
  localCalendarDate,
  membershipStanding,
} from "./financial";

describe("membership lifecycle", () => {
  it("only accepts approved state transitions", () => {
    expect(canTransitionMembership("PENDING", "ACTIVE")).toBe(true);
    expect(canTransitionMembership("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionMembership("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionMembership("EXPIRED", "ACTIVE")).toBe(false);
    expect(canTransitionMembership("CANCELLED", "ACTIVE")).toBe(false);
  });

  it("uses the calendar day in America/Asuncion at UTC boundaries", () => {
    expect(localCalendarDate(new Date("2026-08-09T02:59:59.999Z"))).toBe("2026-08-08");
    expect(localCalendarDate(new Date("2026-08-09T03:00:00.000Z"))).toBe("2026-08-09");
  });

  it("classifies active memberships as upcoming, current or overdue", () => {
    const base = { endDate: "2026-08-31", startDate: "2026-08-09", status: "ACTIVE" } as const;
    expect(membershipStanding(base, new Date("2026-08-09T02:59:59.999Z"))).toBe("UPCOMING");
    expect(membershipStanding(base, new Date("2026-08-09T03:00:00.000Z"))).toBe("CURRENT");
    expect(membershipStanding(base, new Date("2026-09-01T03:00:00.000Z"))).toBe("OVERDUE");
    expect(membershipStanding({ ...base, status: "SUSPENDED" }, new Date("2026-08-10T12:00:00Z"))).toBe("INACTIVE");
  });
});
