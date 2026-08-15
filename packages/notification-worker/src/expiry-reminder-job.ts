import { createHash } from "node:crypto";
import type { Membership, Notification } from "@gym-adr/domain";
import type { MembershipFanOutCursors } from "@gym-adr/data-access";

export interface DueMembershipPort {
  getActive(userId: string): Promise<Membership | undefined>;
  listDue(dueDate: string, options?: { readonly cursors?: MembershipFanOutCursors; readonly limitPerShard?: number }): Promise<{ readonly cursors?: MembershipFanOutCursors; readonly memberships: readonly Membership[] }>;
}
export interface ReminderCreationPort {
  createReminder(input: { readonly createdAt: string; readonly dueDate: string; readonly membershipId: string; readonly notificationId: string; readonly recipientUserId: string; readonly scheduledAt: string; readonly type: "MEMBERSHIP_EXPIRY" }): Promise<Notification>;
}
const paraguayDate = (date: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "America/Asuncion", year: "numeric" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
export const expiryReminderTargetDate = (now: Date): string => paraguayDate(new Date(now.getTime() + 5 * 86_400_000));
const reminderId = (membershipId: string, dueDate: string): string => `reminder-${createHash("sha256").update(`${membershipId}\0MEMBERSHIP_EXPIRY\0${dueDate}`).digest("hex").slice(0, 32)}`;
export const runExpiryReminderJob = async (input: { readonly memberships: DueMembershipPort; readonly now: Date; readonly notifications: ReminderCreationPort }): Promise<{ readonly createdOrReplayed: number; readonly skipped: number; readonly targetDate: string }> => {
  const targetDate = expiryReminderTargetDate(input.now);
  const timestamp = input.now.toISOString();
  let cursors: MembershipFanOutCursors | undefined;
  let createdOrReplayed = 0;
  let skipped = 0;
  for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
    const page = await input.memberships.listDue(targetDate, { ...(cursors === undefined ? {} : { cursors }), limitPerShard: 25 });
    for (const membership of page.memberships) {
      const active = await input.memberships.getActive(membership.userId);
      if (membership.status !== "ACTIVE" || membership.endDate !== targetDate || active?.id !== membership.id || active.endDate !== targetDate) { skipped += 1; continue; }
      await input.notifications.createReminder({ createdAt: timestamp, dueDate: targetDate, membershipId: membership.id, notificationId: reminderId(membership.id, targetDate), recipientUserId: membership.userId, scheduledAt: timestamp, type: "MEMBERSHIP_EXPIRY" });
      createdOrReplayed += 1;
    }
    cursors = page.cursors;
    if (cursors === undefined) return { createdOrReplayed, skipped, targetDate };
  }
  throw new Error("La consulta de vencimientos superó el límite operativo.");
};
