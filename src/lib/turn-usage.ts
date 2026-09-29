/**
 * TURN usage panel, client-safe half: the view `getTurnUsageFn` returns (src/server/turn-usage.ts).
 * Relayed egress this month against Cloudflare's free tier (ADR 3). No server-only imports.
 */

/** Cloudflare Realtime TURN's free egress per month, in GB (ADR 3). */
export const TURN_FREE_TIER_GB = 1_000;
/** Usage at or past this share of the free tier raises the warning. */
export const TURN_WARNING_RATIO = 0.8;
/** Cloudflare bills in decimal gigabytes. */
export const BYTES_PER_GB = 1_000_000_000;

/** One UTC day of relayed egress. */
export interface TurnUsageDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  gb: number;
}

/** What the panel shows: usage, or why there is none. */
export type TurnUsage =
  | { status: "not-configured" }
  | { status: "unavailable" }
  | {
      status: "ok";
      /** `YYYY-MM`, UTC. */
      month: string;
      totalGb: number;
      /** Of the free tier; can pass 100. */
      percent: number;
      /** At or past `TURN_WARNING_RATIO` of the free tier. */
      warning: boolean;
      /** Every UTC day from the 1st through today, gaps as zeros. */
      daily: TurnUsageDay[];
    };
