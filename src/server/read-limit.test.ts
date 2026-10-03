import { describe, expect, it } from "vitest";
import {
  createReadLimiter,
  PUBLIC_READ_LIMITS,
  PUBLIC_READ_WINDOW_MS,
  type PublicRead,
} from "./read-limit.ts";

const T0 = new Date("2026-10-02T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

/** How many of `count` reads at `at` get through. */
function allowed(
  limiter: ReturnType<typeof createReadLimiter>,
  kind: PublicRead,
  ip: string,
  count: number,
  at = T0,
) {
  return Array.from({ length: count }, () => limiter.allow(kind, ip, at)).filter(Boolean).length;
}

describe("public read limits", () => {
  it("are search 30, card 30, profile 60 and home 120 a minute", () => {
    expect(PUBLIC_READ_LIMITS).toEqual({ search: 30, card: 30, profile: 60, home: 120 });
    expect(PUBLIC_READ_WINDOW_MS).toBe(60_000);
  });

  it.each(Object.entries(PUBLIC_READ_LIMITS) as [PublicRead, number][])(
    "let %s through up to its limit (%i), then refuse",
    (kind, max) => {
      const limiter = createReadLimiter();
      expect(allowed(limiter, kind, "203.0.113.5", max)).toBe(max);
      expect(limiter.allow(kind, "203.0.113.5", T0)).toBe(false);
    },
  );

  it("count each IP and each kind of read apart", () => {
    const limiter = createReadLimiter();
    allowed(limiter, "search", "203.0.113.5", PUBLIC_READ_LIMITS.search);
    expect(limiter.allow("search", "203.0.113.5", T0)).toBe(false);
    expect(limiter.allow("search", "203.0.113.6", T0)).toBe(true);
    expect(limiter.allow("profile", "203.0.113.5", T0)).toBe(true);
    expect(limiter.allow("home", "203.0.113.5", T0)).toBe(true);
  });

  it("let an IP read again once the window has passed", () => {
    const limiter = createReadLimiter();
    allowed(limiter, "search", "203.0.113.5", PUBLIC_READ_LIMITS.search);
    expect(limiter.allow("search", "203.0.113.5", later(PUBLIC_READ_WINDOW_MS - 1))).toBe(false);
    expect(limiter.allow("search", "203.0.113.5", later(PUBLIC_READ_WINDOW_MS + 1))).toBe(true);
  });

  it("don't count refused reads against the window", () => {
    const limiter = createReadLimiter();
    allowed(limiter, "search", "203.0.113.5", PUBLIC_READ_LIMITS.search);
    allowed(limiter, "search", "203.0.113.5", 100, later(30_000));
    expect(limiter.allow("search", "203.0.113.5", later(PUBLIC_READ_WINDOW_MS + 1))).toBe(true);
  });

  it("scale every budget (e2e runs raise it)", () => {
    const limiter = createReadLimiter(10);
    expect(allowed(limiter, "search", "203.0.113.5", 300)).toBe(300);
    expect(limiter.allow("search", "203.0.113.5", T0)).toBe(false);
  });

  it("keep an IP that is still over its limit when many IPs are tracked", () => {
    const limiter = createReadLimiter();
    allowed(limiter, "search", "busy", PUBLIC_READ_LIMITS.search, later(1_000));
    for (let i = 0; i < 10_000; i++) limiter.allow("home", `198.51.100.${i}`, T0);
    // The sweep runs on this read: the idle IPs go, "busy" is inside its window and stays.
    expect(limiter.allow("search", "busy", later(PUBLIC_READ_WINDOW_MS + 1))).toBe(false);
    expect(limiter.allow("search", "busy", later(1_000 + PUBLIC_READ_WINDOW_MS + 1))).toBe(true);
  });
});
