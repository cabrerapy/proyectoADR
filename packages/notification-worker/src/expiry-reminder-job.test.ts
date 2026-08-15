import { describe, expect, it, vi } from "vitest";
import type { Membership, Notification } from "@gym-adr/domain";
import { expiryReminderTargetDate, runExpiryReminderJob } from "./expiry-reminder-job";

const membership: Membership = { createdAt: "2026-08-01T12:00:00Z", createdBy: "admin", currency: "PYG", endDate: "2026-08-19", expectedAmount: 200000, frequency: "MONTHLY", id: "membership-001", planId: "plan-001", planName: "Plan mensual", startDate: "2026-08-01", status: "ACTIVE", updatedAt: "2026-08-01T12:00:00Z", userId: "student-001", version: 1 };
describe("expiry reminder job", () => {
  it("uses the Paraguay date five days ahead", () => { expect(expiryReminderTargetDate(new Date("2026-08-14T12:00:00Z"))).toBe("2026-08-19"); });
  it("queries due views, strongly revalidates active membership and survives a double run", async () => {
    const memberships = { getActive: vi.fn(async () => membership), listDue: vi.fn(async () => ({ memberships: [membership] })) };
    const records = new Map<string, Notification>();
    const notifications = { createReminder: vi.fn(async (input) => { const existing = records.get(input.notificationId); if (existing !== undefined) return existing; const value: Notification = { ...input, id: input.notificationId, status: "PENDING", updatedAt: input.createdAt, version: 1 }; records.set(input.notificationId, value); return value; }) };
    const now = new Date("2026-08-14T12:00:00Z");
    await runExpiryReminderJob({ memberships, notifications, now });
    await runExpiryReminderJob({ memberships, notifications, now });
    expect(memberships.listDue).toHaveBeenCalledWith("2026-08-19", expect.objectContaining({ limitPerShard: 25 }));
    expect(memberships.getActive).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
  });
  it("skips stale due views after strong revalidation", async () => { const result = await runExpiryReminderJob({ memberships: { getActive: vi.fn(async () => ({ ...membership, id: "new-membership" })), listDue: vi.fn(async () => ({ memberships: [membership] })) }, notifications: { createReminder: vi.fn() }, now: new Date("2026-08-14T12:00:00Z") }); expect(result).toMatchObject({ createdOrReplayed: 0, skipped: 1 }); });
});
