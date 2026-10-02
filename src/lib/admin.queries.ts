/**
 * Admin query keys and options. The /admin loader calls `ensureQueryData` on each;
 * the dashboard reads them with `useSuspenseQuery`.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ListAdminRecentRoomsInput, ListAdminUsersInput } from "./admin";
import {
  getAdminDailySeriesFn,
  getAdminLeaderboardsFn,
  getAdminOverviewFn,
  getTurnUsageFn,
  listAdminLiveRoomsFn,
  listAdminRecentRoomsFn,
  listAdminUsersFn,
} from "./admin.functions";
import { STATS_REFRESH_MS } from "./profiles";
import { roomKeys } from "./rooms.queries";

export const adminKeys = {
  /**
   * Under `roomKeys.all`: every admin number moves when rooms do (created, joined, ended),
   * so anything that invalidates the rooms refreshes these too. The stats ones (overview,
   * daily series, leaderboards, users) include rooms in progress, so they also refetch
   * every minute.
   */
  all: [...roomKeys.all, "admin"] as const,
  overview: () => [...adminKeys.all, "overview"] as const,
  daily: () => [...adminKeys.all, "daily"] as const,
  live: () => [...adminKeys.all, "live"] as const,
  /** Every page of the recent-rooms table. */
  recent: () => [...adminKeys.all, "recent"] as const,
  recentPage: (input: ListAdminRecentRoomsInput) => [...adminKeys.recent(), input] as const,
  turnUsage: () => [...adminKeys.all, "turn-usage"] as const,
  leaderboards: () => [...adminKeys.all, "leaderboards"] as const,
  /** Every page of the users table: bans and role changes refetch them all. */
  users: () => [...adminKeys.all, "users"] as const,
  usersPage: (input: ListAdminUsersInput) => [...adminKeys.users(), input] as const,
};

/** All-time totals and the last 30 days against the 30 before. */
export const adminOverviewQuery = () =>
  queryOptions({
    queryKey: adminKeys.overview(),
    queryFn: () => getAdminOverviewFn(),
    refetchInterval: STATS_REFRESH_MS,
  });

/** The last 30 UTC days of platform counters, gaps filled with zeros. */
export const adminDailySeriesQuery = () =>
  queryOptions({
    queryKey: adminKeys.daily(),
    queryFn: () => getAdminDailySeriesFn(),
    refetchInterval: STATS_REFRESH_MS,
  });

/** Every live room, private ones included. */
export const adminLiveRoomsQuery = () =>
  queryOptions({ queryKey: adminKeys.live(), queryFn: () => listAdminLiveRoomsFn() });

/** A page of live rooms and rooms ended within 30 days, private ones included, as searched. */
export const adminRecentRoomsQuery = (input: ListAdminRecentRoomsInput) =>
  queryOptions({
    queryKey: adminKeys.recentPage(input),
    queryFn: () => listAdminRecentRoomsFn({ data: input }),
  });

/** Relayed TURN egress this month (the server caches Cloudflare's answer for about 15 minutes). */
export const turnUsageQuery = () =>
  queryOptions({ queryKey: adminKeys.turnUsage(), queryFn: () => getTurnUsageFn() });

/** Top users by lifetime hours streamed and watched. */
export const adminLeaderboardsQuery = () =>
  queryOptions({
    queryKey: adminKeys.leaderboards(),
    queryFn: () => getAdminLeaderboardsFn(),
    refetchInterval: STATS_REFRESH_MS,
  });

/** A page of the users table, as searched. */
export const adminUsersQuery = (input: ListAdminUsersInput) =>
  queryOptions({
    queryKey: adminKeys.usersPage(input),
    queryFn: () => listAdminUsersFn({ data: input }),
    refetchInterval: STATS_REFRESH_MS,
  });
