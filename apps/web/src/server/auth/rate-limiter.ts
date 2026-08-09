import { createHash } from "node:crypto";

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): boolean;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 1_000,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
  }

  consume(key: string, limit: number, windowMs: number): boolean {
    if (
      key.length < 1 || key.length > 256 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 86_400_000
    ) return false;

    const now = this.now();
    const current = this.entries.get(key);
    if (current === undefined || current.resetAt <= now) {
      if (current !== undefined) this.entries.delete(key);
      if (this.entries.size >= this.maxEntries) {
        for (const [entryKey, entry] of this.entries) {
          if (entry.resetAt <= now) this.entries.delete(entryKey);
        }
      }
      if (this.entries.size >= this.maxEntries) return false;
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}

export const requestRateKey = (request: Request, operation: string): string => {
  const viewerAddress = normalizeViewerAddress(
    request.headers.get("cloudfront-viewer-address"),
  );
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return rateKey(operation, viewerAddress ?? forwarded ?? "local");
};

export const principalRateKey = (
  userId: string,
  operation: string,
): string => rateKey(operation, userId);

const rateKey = (operation: string, source: string): string => {
  const safeOperation = /^[a-z][a-z0-9-]{0,63}$/u.test(operation)
    ? operation
    : "invalid-operation";
  const safeSource = source.length > 0 && source.length <= 256
    ? source
    : "unknown";
  return `${safeOperation}:${createHash("sha256").update(safeSource).digest("hex")}`;
};

const normalizeViewerAddress = (value: string | null): string | undefined => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  const bracketedIpv6 = /^\[([0-9A-Fa-f:.]+)\](?::\d{1,5})?$/u.exec(normalized);
  if (bracketedIpv6?.[1] !== undefined) return bracketedIpv6[1];
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})$/u.exec(normalized);
  return ipv4WithPort?.[1] ?? normalized;
};
