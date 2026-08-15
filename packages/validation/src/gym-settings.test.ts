import { describe, expect, it } from "vitest";

import { validateGymSettingsCommand } from "./gym-settings";

describe("gym settings validation", () => {
  it("accepts the closed operational settings shape", () => {
    expect(validateGymSettingsCommand({ cancellationWindowMinutes: 120, currency: "PYG", expectedVersion: 1, gymName: "Gym ADR", timezone: "America/Asuncion", whatsappNumber: "+595981000000" })).toMatchObject({ success: true });
  });

  it("rejects secrets, unsupported timezone and invalid versions", () => {
    expect(validateGymSettingsCommand({ cancellationWindowMinutes: 120, clientSecret: "forbidden", currency: "PYG", gymName: "Gym ADR", timezone: "America/Asuncion" })).toMatchObject({ success: false });
    expect(validateGymSettingsCommand({ cancellationWindowMinutes: 120, currency: "PYG", expectedVersion: 0, gymName: "Gym ADR", timezone: "UTC" })).toMatchObject({ success: false });
  });
});
