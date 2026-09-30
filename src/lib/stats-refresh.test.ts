import { describe, expect, it } from "vitest";
import {
  adminDailySeriesQuery,
  adminLeaderboardsQuery,
  adminOverviewQuery,
  adminUsersQuery,
} from "./admin.queries";
import { homeSummaryQuery } from "./home.queries";
import { STATS_REFRESH_MS } from "./profiles";
import { profileQuery, searchUsersQuery } from "./profiles.queries";

// Stats include rooms in progress, so the pages showing them refetch as the hours move.
describe("stats queries", () => {
  const queries = {
    homeSummary: homeSummaryQuery(),
    profile: profileQuery("u1"),
    userSearch: searchUsersQuery("kodama"),
    adminOverview: adminOverviewQuery(),
    adminDailySeries: adminDailySeriesQuery(),
    adminLeaderboards: adminLeaderboardsQuery(),
    adminUsers: adminUsersQuery({ page: 1 }),
  };

  it.each(Object.entries(queries))("%s refetches every minute", (_, query) => {
    expect(query.refetchInterval).toBe(STATS_REFRESH_MS);
    expect(STATS_REFRESH_MS).toBe(60_000);
    // Hidden tabs don't poll (TanStack's default).
    expect("refetchIntervalInBackground" in query).toBe(false);
  });
});
