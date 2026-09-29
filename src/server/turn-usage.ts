/**
 * TURN usage for the admin dashboard (GitHub issue #47, ADR 3 addendum): account-wide TURN egress
 * bytes per UTC day this month from Cloudflare's GraphQL Analytics API, against the free tier
 * (which is per account, not per TURN key). The API is behind `TurnAnalytics`
 * so tests use a fake; results are cached for `TURN_USAGE_CACHE_MS`. The analytics token is
 * server-only and never logged or returned.
 */
import { z } from "zod";
import {
  BYTES_PER_GB,
  TURN_FREE_TIER_GB,
  TURN_WARNING_RATIO,
  type TurnUsage,
} from "~/lib/turn-usage";
import { type Caller, requireAdmin } from "./caller.ts";
import { type Clock, systemClock } from "./clock.ts";
import { env } from "./env.ts";

/** How long Cloudflare's answer is reused. */
export const TURN_USAGE_CACHE_MS = 15 * 60_000;

/** Egress in bytes for one UTC day (`YYYY-MM-DD`). */
export interface TurnEgressDay {
  day: string;
  bytes: number;
}

/** Reads TURN egress from Cloudflare (a fake in tests). */
export interface TurnAnalytics {
  /** Egress by UTC day from `from` through `to` (both `YYYY-MM-DD`); days may repeat or be missing. */
  egressByDay(from: string, to: string): Promise<TurnEgressDay[]>;
}

const analyticsResponse = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(
          z.object({
            callsTurnUsageAdaptiveGroups: z.array(
              z.object({
                dimensions: z.object({ datetimeHour: z.string() }),
                sum: z.object({ egressBytes: z.number() }),
              }),
            ),
          }),
        ),
      }),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

// Account-wide (every TURN key), grouped by hour only: at most 24 x 31 rows, far under `limit`.
const TURN_EGRESS_QUERY = `query turnEgress($accountId: string!, $from: Date!, $to: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }) {
        dimensions { datetimeHour }
        sum { egressBytes }
      }
    }
  }
}`;

/** Cloudflare's GraphQL Analytics API for the whole account, with a read-only analytics token. */
export function cloudflareTurnAnalytics(options: {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
}): TurnAnalytics {
  const fetchFn = options.fetch ?? fetch;
  return {
    async egressByDay(from, to) {
      const response = await fetchFn("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: TURN_EGRESS_QUERY,
          variables: { accountId: options.accountId, from, to },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Cloudflare analytics answered ${response.status}`);
      const { data, errors } = analyticsResponse.parse(await response.json());
      // GraphQL reports failures with a 200; the messages never include the token.
      if (errors?.length || !data) {
        throw new Error(`Cloudflare analytics failed: ${errors?.map((e) => e.message).join("; ")}`);
      }
      return (data.viewer.accounts[0]?.callsTurnUsageAdaptiveGroups ?? []).map((group) => ({
        day: group.dimensions.datetimeHour.slice(0, 10),
        bytes: group.sum.egressBytes,
      }));
    },
  };
}

/** The usage view for `today`'s month from `rows`: totals, share of the free tier, zero-filled days. */
export function summariseTurnUsage(rows: TurnEgressDay[], today: string): TurnUsage {
  const month = today.slice(0, 7);
  const bytesByDay = new Map<string, number>();
  for (const { day, bytes } of rows) {
    if (day.startsWith(month)) bytesByDay.set(day, (bytesByDay.get(day) ?? 0) + bytes);
  }
  const lastDay = Number(today.slice(8));
  const daily = Array.from({ length: lastDay }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { day, gb: (bytesByDay.get(day) ?? 0) / BYTES_PER_GB };
  });
  const totalGb = daily.reduce((sum, d) => sum + d.gb, 0);
  const percent = (totalGb / TURN_FREE_TIER_GB) * 100;
  return {
    status: "ok",
    month,
    totalGb,
    percent,
    warning: percent >= TURN_WARNING_RATIO * 100,
    daily,
  };
}

export interface TurnUsageServiceOptions {
  /** Null: no analytics configured. */
  analytics: TurnAnalytics | null;
  clock?: Clock;
  /** Where failures go. Defaults to the console. */
  log?: (line: string, error?: unknown) => void;
}

export class TurnUsageService {
  readonly #analytics: TurnAnalytics | null;
  readonly #clock: Clock;
  readonly #log: (line: string, error?: unknown) => void;
  #cached: { month: string; expiresAt: number; usage: Promise<TurnUsage> } | undefined;

  constructor(options: TurnUsageServiceOptions) {
    this.#analytics = options.analytics;
    this.#clock = options.clock ?? systemClock;
    this.#log = options.log ?? ((line, error) => console.error(line, error));
  }

  /** This month's TURN usage, from the cache when under 15 minutes old. Never throws for API failures. */
  async usage(caller: Caller): Promise<TurnUsage> {
    requireAdmin(caller);
    const analytics = this.#analytics;
    if (!analytics) return { status: "not-configured" };
    const now = this.#clock.now();
    const today = now.toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    // Keyed by month: on the 1st, last month's answer isn't shown for up to 15 minutes.
    if (this.#cached?.month === month && this.#cached.expiresAt > now.getTime()) {
      return this.#cached.usage;
    }
    const entry = {
      month,
      expiresAt: now.getTime() + TURN_USAGE_CACHE_MS,
      usage: analytics
        .egressByDay(`${month}-01`, today)
        .then((rows) => summariseTurnUsage(rows, today))
        .catch((error): TurnUsage => {
          this.#log("[turn-usage] Cloudflare analytics failed", error);
          return { status: "unavailable" };
        }),
    };
    this.#cached = entry;
    const usage = await entry.usage;
    // Failures aren't cached: the next request tries again.
    if (usage.status === "unavailable" && this.#cached === entry) this.#cached = undefined;
    return usage;
  }
}

let service: TurnUsageService | undefined;

/** The server's `TurnUsageService`, configured when the account id and analytics token are set. */
export function getTurnUsageService(): TurnUsageService {
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_ANALYTICS_API_TOKEN: apiToken } = env;
  service ??= new TurnUsageService({
    analytics: accountId && apiToken ? cloudflareTurnAnalytics({ accountId, apiToken }) : null,
  });
  return service;
}
