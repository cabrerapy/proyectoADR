import { createHash } from "node:crypto";

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): boolean;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    const current = this.entries.get(key);
    if (current === undefined || current.resetAt <= now) {
      if (this.entries.size >= 1_000) this.entries.clear();
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}

export const requestRateKey = (request: Request, operation: string): string => {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return `${operation}:${createHash("sha256").update(forwarded ?? "local").digest("hex")}`;
};
