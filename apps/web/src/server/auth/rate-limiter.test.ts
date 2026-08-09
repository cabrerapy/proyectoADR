import { describe, expect, it } from "vitest";

import {
  FixedWindowRateLimiter,
  principalRateKey,
  requestRateKey,
} from "./rate-limiter";

describe("fixed-window rate limiter", () => {
  it("enforces the configured limit and resets only after the window", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(() => now);
    expect(limiter.consume("operation:key", 2, 1_000)).toBe(true);
    expect(limiter.consume("operation:key", 2, 1_000)).toBe(true);
    expect(limiter.consume("operation:key", 2, 1_000)).toBe(false);
    now = 2_000;
    expect(limiter.consume("operation:key", 2, 1_000)).toBe(true);
  });

  it("fails closed at capacity instead of clearing active counters", () => {
    const limiter = new FixedWindowRateLimiter(() => 1_000, 2);
    expect(limiter.consume("first:key", 1, 60_000)).toBe(true);
    expect(limiter.consume("second:key", 1, 60_000)).toBe(true);
    expect(limiter.consume("third:key", 1, 60_000)).toBe(false);
    expect(limiter.consume("first:key", 1, 60_000)).toBe(false);
  });

  it("rejects invalid policies and hashes request/principal identifiers", () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.consume("", 1, 1_000)).toBe(false);
    expect(limiter.consume("key", 0, 1_000)).toBe(false);
    expect(limiter.consume("key", 1, 999)).toBe(false);

    const requestKey = requestRateKey(new Request("https://app.example.com", {
      headers: { "cloudfront-viewer-address": "203.0.113.8:443" },
    }), "login");
    const sameViewerKey = requestRateKey(new Request("https://app.example.com", {
      headers: { "cloudfront-viewer-address": "203.0.113.8:51234" },
    }), "login");
    const userKey = principalRateKey("private-user-id", "profile-write");
    expect(requestKey).toMatch(/^login:[a-f0-9]{64}$/u);
    expect(sameViewerKey).toBe(requestKey);
    expect(userKey).toMatch(/^profile-write:[a-f0-9]{64}$/u);
    expect(requestKey).not.toContain("203.0.113.8");
    expect(userKey).not.toContain("private-user-id");
  });
});
