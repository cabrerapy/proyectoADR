import { describe, expect, it } from "vitest";

import {
  LOCAL_IDENTITIES,
  LOCAL_SESSION_PREFIX,
  LocalTokenClient,
  isLocalIdentityAlias,
} from "./local-token-client";

describe("local-only authentication adapter", () => {
  it("maps an allow-listed opaque alias to a fixed Cognito subject", async () => {
    await expect(
      new LocalTokenClient().verifySessionToken(`${LOCAL_SESSION_PREFIX}student`),
    ).resolves.toEqual(LOCAL_IDENTITIES.student);
  });

  it("does not accept a role, arbitrary subject or production token", async () => {
    const client = new LocalTokenClient();
    await expect(client.verifySessionToken(`${LOCAL_SESSION_PREFIX}ADMIN`)).rejects.toThrow();
    await expect(client.verifySessionToken(`${LOCAL_SESSION_PREFIX}unknown`)).rejects.toThrow();
    await expect(client.verifySessionToken("header.payload.signature")).rejects.toThrow();
    expect(isLocalIdentityAlias("admin")).toBe(true);
    expect(isLocalIdentityAlias("ADMIN")).toBe(false);
  });
});
