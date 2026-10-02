/**
 * Per-IP rate limits on the public reads (ADR 20 addendum): profile, user search and the home
 * summary are open to visitors and each runs the live-stats queries, so one client can't hammer
 * them. Server functions apply them through `limitPublicRead` (./request-caller.ts); this file
 * is the limiter itself, which tests drive with explicit IPs and times.
 */
import { READ_RATE_LIMITED_MESSAGE } from "../lib/profiles.ts";
import { withinRateLimit } from "./rate-limit.ts";

/** What a public read is limited as: each kind has its own budget per IP. */
export type PublicRead = "profile" | "search" | "home";

export const PUBLIC_READ_WINDOW_MS = 60_000;

/**
 * At most this many reads of each kind per IP in any `PUBLIC_READ_WINDOW_MS`. A page load costs
 * one profile or home read, and the pages refetch about once a minute (`STATS_REFRESH_MS`) or
 * when the lobby changes; search runs once typing pauses, so it gets the smallest budget.
 */
export const PUBLIC_READ_LIMITS: Record<PublicRead, number> = {
  search: 30,
  profile: 60,
  home: 120,
};

/**
 * Thrown when an IP is over its limit for a kind of read. Home's user search shows a notice for
 * it; the profile and home loaders have no handling of their own yet, so the router's default
 * error page shows the message.
 */
export class ReadRateLimitedError extends Error {
  constructor() {
    super(READ_RATE_LIMITED_MESSAGE);
    this.name = "ReadRateLimitedError";
  }
}

/** Past this many tracked (kind, IP) pairs, the ones with nothing recent are dropped. */
const MAX_TRACKED = 10_000;

export interface ReadLimiter {
  /** Whether `ip` may do a `kind` read at `at`, recording it if so. */
  allow(kind: PublicRead, ip: string, at: Date): boolean;
}

/** A limiter whose budgets are `PUBLIC_READ_LIMITS` times `scale` (e2e runs raise it). */
export function createReadLimiter(scale = 1): ReadLimiter {
  const reads = new Map<string, number[]>();
  return {
    allow(kind, ip, at) {
      if (reads.size >= MAX_TRACKED) {
        // Many IPs (an IPv6 range, say) must not grow the map without bound.
        const since = at.getTime() - PUBLIC_READ_WINDOW_MS;
        for (const [key, times] of reads) {
          if ((times.at(-1) ?? 0) <= since) reads.delete(key);
        }
      }
      return withinRateLimit(
        reads,
        `${kind}:${ip}`,
        PUBLIC_READ_LIMITS[kind] * scale,
        PUBLIC_READ_WINDOW_MS,
        at,
      );
    },
  };
}
