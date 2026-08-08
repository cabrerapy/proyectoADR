import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  normalizePersonName,
  SearchTokenService,
} from "./search-tokens";

const key = (version: string, fill: number) => ({
  secret: new Uint8Array(32).fill(fill),
  version,
});

describe("SearchTokenService", () => {
  it("normalizes email and names without exposing their values in tokens", () => {
    const service = new SearchTokenService([key("v1", 1)]);

    expect(normalizeEmail("  ALUMNO@Example.COM ")).toBe("alumno@example.com");
    expect(normalizePersonName("  María   Núñez ")).toBe("maria nunez");
    const token = service.emailTokens("ALUMNO@example.com").at(0)?.token;
    expect(token).toBeDefined();
    expect(token).toMatch(/^[a-f0-9]{64}$/u);
    expect(token).not.toContain("alumno");
  });

  it("creates one deterministic token per active rotation version", () => {
    const service = new SearchTokenService([key("v2", 2), key("v1", 1)]);

    expect(service.versions).toEqual(["v1", "v2"]);
    expect(service.emailTokens("student@example.com")).toHaveLength(2);
    expect(service.nameSearchTokens("María")).toHaveLength(2);
    expect(service.namePrefixTokens("Maria")).toHaveLength(6);
  });

  it("rejects weak keys, invalid input, and unavailable rotation versions", () => {
    expect(() => new SearchTokenService([key("v1", 1), key("v1", 2)]))
      .toThrowError(/repetirse/u);
    expect(() =>
      new SearchTokenService([{ secret: new Uint8Array(8), version: "v1" }])
    ).toThrowError(/32 bytes/u);

    const service = new SearchTokenService([key("v1", 1)]);
    expect(() => service.emailTokens("not-an-email")).toThrowError(/formato/u);
    expect(() => service.nameSearchTokens("Al")).toThrowError(/entre 3 y 80/u);
    expect(() => service.emailTokens("a@example.com", ["v2"]))
      .toThrowError(/no está disponible/u);
  });
});
