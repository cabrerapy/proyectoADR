import { describe, expect, it } from "vitest";
import { activeMembershipFixture, activeStudentFixture, repositoryFixtureIds } from "./repository-fixtures";

describe("repository fixtures", () => {
  it("creates deterministic linked identifiers without shared mutable state", () => {
    expect(repositoryFixtureIds("007")).toMatchObject({ membershipId: "membership-007", userId: "student-007" });
    expect(activeStudentFixture("007")).toMatchObject({ id: "student-007", roles: ["STUDENT"], status: "ACTIVE" });
    expect(activeMembershipFixture("007")).toMatchObject({ id: "membership-007", userId: "student-007", status: "ACTIVE" });
    expect(activeStudentFixture()).not.toBe(activeStudentFixture());
  });
});
