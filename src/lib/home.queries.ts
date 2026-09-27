/**
 * Home query keys and options. The home loader calls
 * `ensureQueryData(homeSummaryQuery())`; the sidebar reads it with `useSuspenseQuery`.
 */
import { queryOptions } from "@tanstack/react-query";
import { getHomeSummaryFn } from "./home.functions";
import { roomKeys } from "./rooms.queries";

export const homeKeys = {
  /**
   * Under `roomKeys.all`: the counts change whenever rooms do (created, joined, ended and
   * rolled up into stats), so anything that invalidates the rooms refreshes the summary too.
   */
  summary: () => [...roomKeys.all, "home-summary"] as const,
};

/** The home sidebar's "Right Now" and "Community" numbers, as the caller sees them. */
export const homeSummaryQuery = () =>
  queryOptions({ queryKey: homeKeys.summary(), queryFn: () => getHomeSummaryFn() });
