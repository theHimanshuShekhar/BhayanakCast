/**
 * Admin query keys and options. The /admin loader calls `ensureQueryData` on each;
 * the dashboard reads them with `useSuspenseQuery`.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ListAdminUsersInput } from "./admin";
import {
  getAdminDailySeriesFn,
  getAdminLeaderboardsFn,
  getAdminOverviewFn,
  listAdminLiveRoomsFn,
  listAdminRecentRoomsFn,
  listAdminUsersFn,
} from "./admin.functions";
import { roomKeys } from "./rooms.queries";

export const adminKeys = {
  /**
   * Under `roomKeys.all`: every admin number moves when rooms do (created, joined, ended
   * and rolled up into stats), so anything that invalidates the rooms refreshes these too.
   */
  all: [...roomKeys.all, "admin"] as const,
  overview: () => [...adminKeys.all, "overview"] as const,
  daily: () => [...adminKeys.all, "daily"] as const,
  live: () => [...adminKeys.all, "live"] as const,
  recent: () => [...adminKeys.all, "recent"] as const,
  leaderboards: () => [...adminKeys.all, "leaderboards"] as const,
  /** Every page of the users table: bans and role changes refetch them all. */
  users: () => [...adminKeys.all, "users"] as const,
  usersPage: (input: ListAdminUsersInput) => [...adminKeys.users(), input] as const,
};

/** All-time totals and the last 30 days against the 30 before. */
export const adminOverviewQuery = () =>
  queryOptions({ queryKey: adminKeys.overview(), queryFn: () => getAdminOverviewFn() });

/** The last 30 UTC days of platform counters, gaps filled with zeros. */
export const adminDailySeriesQuery = () =>
  queryOptions({ queryKey: adminKeys.daily(), queryFn: () => getAdminDailySeriesFn() });

/** Every live room, private ones included. */
export const adminLiveRoomsQuery = () =>
  queryOptions({ queryKey: adminKeys.live(), queryFn: () => listAdminLiveRoomsFn() });

/** Live rooms and rooms ended within 30 days, private ones included. */
export const adminRecentRoomsQuery = () =>
  queryOptions({ queryKey: adminKeys.recent(), queryFn: () => listAdminRecentRoomsFn() });

/** Top users by lifetime hours streamed and watched. */
export const adminLeaderboardsQuery = () =>
  queryOptions({ queryKey: adminKeys.leaderboards(), queryFn: () => getAdminLeaderboardsFn() });

/** A page of the users table, as searched. */
export const adminUsersQuery = (input: ListAdminUsersInput) =>
  queryOptions({
    queryKey: adminKeys.usersPage(input),
    queryFn: () => listAdminUsersFn({ data: input }),
  });
