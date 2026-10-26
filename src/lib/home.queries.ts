/**
 * Home query keys and options. The home loader calls
 * `ensureQueryData(homeSummaryQuery())`; the sidebar reads it with `useSuspenseQuery`.
 */
import { queryOptions } from "@tanstack/react-query";
import { getHomeSummaryFn, getYouCardFn } from "./home.functions";
import { STATS_REFRESH_MS } from "./profiles";
import { roomKeys } from "./rooms.queries";

export const homeKeys = {
  /**
   * Under `roomKeys.all`: the counts change whenever rooms do (created, joined, ended), so
   * anything that invalidates the rooms refreshes the summary too. The community numbers
   * include rooms in progress, so the query also refetches every minute.
   */
  summary: () => [...roomKeys.all, "home-summary"] as const,
  /** Keyed by the signed-in user, so one caller's figures are never served to another. */
  you: (userId: string) => [...roomKeys.all, "home-you", userId] as const,
};

/** The home sidebar's "Right Now" and "Community" numbers, as the caller sees them. */
export const homeSummaryQuery = () =>
  queryOptions({
    queryKey: homeKeys.summary(),
    queryFn: () => getHomeSummaryFn(),
    refetchInterval: STATS_REFRESH_MS,
  });

/** The "You" card's figures for the signed-in `userId` (the server reads the caller, not this key). */
export const youCardQuery = (userId: string) =>
  queryOptions({
    queryKey: homeKeys.you(userId),
    queryFn: () => getYouCardFn(),
    refetchInterval: STATS_REFRESH_MS,
  });
