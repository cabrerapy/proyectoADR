import { validateCancelClassSession, validateClassSessionQuery, validateCreateClassSession, validateOwnClassScheduleQuery, validateUpdateClassSession } from "@gym-adr/validation";
import { describe, expect, it } from "vitest";

describe("class session validation", () => {
  const command = { capacity: 16, classTypeId: "type-1", endsAt: "2026-08-10T23:00:00.000Z", startsAt: "2026-08-10T22:00:00.000Z", trainerId: "trainer-1" };
  it("accepts bounded schedules and rejects client-owned derived fields", () => {
    expect(validateCreateClassSession(command)).toMatchObject({ success: true });
    expect(validateUpdateClassSession({ ...command, expectedVersion: 1 })).toMatchObject({ success: true });
    expect(validateCreateClassSession({ ...command, confirmedCount: 10 })).toMatchObject({ success: false });
    expect(validateCreateClassSession({ ...command, capacity: 0 })).toMatchObject({ success: false });
    expect(validateCreateClassSession({ ...command, endsAt: command.startsAt })).toMatchObject({ success: false });
  });
  it("accepts only one valid date query", () => {
    expect(validateClassSessionQuery(new URLSearchParams({ date: "2026-08-10" }))).toMatchObject({ success: true });
    expect(validateClassSessionQuery(new URLSearchParams({ date: "invalid", userId: "other" }))).toMatchObject({ success: false });
  });
  it("requires a bounded cancellation reason, version and opaque cursor", () => {
    expect(validateCancelClassSession({ expectedVersion: 2, reason: "Entrenador no disponible" })).toMatchObject({ success: true });
    expect(validateCancelClassSession({ expectedVersion: 2, reason: "corto" })).toMatchObject({ success: false });
    expect(validateCancelClassSession({ cursor: "not valid!", expectedVersion: 2, reason: "Entrenador no disponible" })).toMatchObject({ success: false });
    expect(validateCancelClassSession({ expectedVersion: 2, reason: "Entrenador no disponible", status: "CANCELLED" })).toMatchObject({ success: false });
  });
  it("accepts a bounded own schedule period and rejects foreign parameters", () => {
    expect(validateOwnClassScheduleQuery(new URLSearchParams({ from: "2026-08-10", to: "2026-08-24" }))).toMatchObject({ success: true });
    expect(validateOwnClassScheduleQuery(new URLSearchParams({ from: "2026-08-10", to: "2026-10-24" }))).toMatchObject({ success: false });
    expect(validateOwnClassScheduleQuery(new URLSearchParams({ from: "2026-08-10", to: "2026-08-24", userId: "other" }))).toMatchObject({ success: false });
  });
});
