/**
 * Home summary, server half: the sidebar's "Right Now" and "Community" numbers.
 * Takes the database and the caller explicitly, like src/server/rooms.ts, so the
 * server function is a thin wrapper and tests call this against PGlite.
 *
 * "Right Now" counts over the live rooms the caller may see, the same way
 * `listLiveRooms` does (open presence and stream intervals of live, visible rooms),
 * so the panel agrees with the Live Now list. "Community" sums the persistent
 * per-user stats, which carry no room data, so it's the same for every caller.
 */
import { type AnyColumn, and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { presenceIntervals, rooms, streamIntervals, user, userStats } from "../db/schema/index.ts";
import type { CommunityTotals, HomeSummary, RightNow } from "../lib/home.ts";
import { secondsToHours } from "../lib/profiles.ts";
import type { Caller } from "./caller.ts";
import { roomVisibleTo } from "./visibility.ts";

/** The sidebar numbers as `caller` sees them. */
export async function getHomeSummary(db: Db, caller: Caller): Promise<HomeSummary> {
  const [rightNow, community] = await Promise.all([
    rightNowCounts(db, caller),
    communityTotals(db),
  ]);
  return { rightNow, community };
}

async function rightNowCounts(db: Db, caller: Caller): Promise<RightNow> {
  const liveVisible = and(isNull(rooms.endedAt), roomVisibleTo(caller));
  const openIn = async (table: typeof presenceIntervals | typeof streamIntervals) => {
    const [row] = await db
      .select({ n: count() })
      .from(table)
      .innerJoin(rooms, eq(rooms.id, table.roomId))
      .innerJoin(user, eq(user.id, table.userId))
      .where(and(isNull(table.endedAt), liveVisible));
    return row?.n ?? 0;
  };
  const [[live], inRooms, streaming] = await Promise.all([
    db.select({ n: count() }).from(rooms).where(liveVisible),
    openIn(presenceIntervals),
    openIn(streamIntervals),
  ]);
  return { liveRooms: live?.n ?? 0, inRooms, streaming };
}

/** Postgres sums integers as bigint/numeric (a string on the wire); read it as a number. */
export const total = (column: AnyColumn) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

async function communityTotals(db: Db): Promise<CommunityTotals> {
  const [[members], [stats]] = await Promise.all([
    db.select({ n: count() }).from(user),
    db
      .select({
        secondsWatched: total(userStats.secondsWatched),
        secondsStreamed: total(userStats.secondsStreamed),
        roomsHosted: total(userStats.roomsHosted),
      })
      .from(userStats),
  ]);
  return {
    members: members?.n ?? 0,
    hoursWatched: secondsToHours(stats?.secondsWatched ?? 0),
    hoursStreamed: secondsToHours(stats?.secondsStreamed ?? 0),
    roomsHosted: stats?.roomsHosted ?? 0,
  };
}
