/**
 * Home summary, server half: the sidebar's "Right Now" and "Community" numbers, and the "You" card.
 * Takes the database and the caller explicitly, like src/server/rooms.ts, so the
 * server function is a thin wrapper and tests call this against PGlite.
 *
 * "Right Now" counts over the live rooms the caller may see, the same way
 * `listLiveRooms` does (open presence and stream intervals of live, visible rooms),
 * so the panel agrees with the Live Now list. "Community" sums the persistent
 * per-user stats plus the rooms in progress over every room, private ones included
 * (`userStatsNow`): anonymous totals that name no room or user, so they're the same for
 * every caller (ADR 16 addendum). `getYouCard` is the caller's own figures, also over every
 * room, read apart from the summary so they get a cache key of their own.
 */
import { and, asc, count, desc, eq, isNull, ne, or, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { presenceIntervals, rooms, streamIntervals, user } from "../db/schema/index.ts";
import type { CommunityTotals, HomeSummary, RightNow, YouCard } from "../lib/home.ts";
import { secondsToHours } from "../lib/profiles.ts";
import type { Caller } from "./caller.ts";
import { username } from "./profiles.ts";
import { userCotimeNow, userStatsNow } from "./stats.ts";
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
export const total = (column: SQLWrapper) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

async function communityTotals(db: Db): Promise<CommunityTotals> {
  const [[members], [stats]] = await Promise.all([
    db.select({ n: count() }).from(user),
    db
      .select({
        secondsWatched: total(userStatsNow.secondsWatched),
        secondsStreamed: total(userStatsNow.secondsStreamed),
        roomsHosted: total(userStatsNow.roomsHosted),
      })
      .from(userStatsNow.from),
  ]);
  return {
    members: members?.n ?? 0,
    hoursWatched: secondsToHours(stats?.secondsWatched ?? 0),
    hoursStreamed: secondsToHours(stats?.secondsStreamed ?? 0),
    roomsHosted: stats?.roomsHosted ?? 0,
  };
}

/**
 * The caller's own figures over every room, private ones included (`userStatsNow`,
 * `userCotimeNow`), rooms in progress too; null for a visitor. Profiles hide private rooms, but
 * only the caller is ever sent this, so nothing of anyone else's leaks (ADR 16 addendum). It
 * takes no user id: the caller is the only user it can read. Ties for the top co-user go to the
 * lowest id, as on a profile.
 */
export async function getYouCard(db: Db, caller: Caller): Promise<YouCard | null> {
  if (!caller.user) return null;
  const userId = caller.user.id;
  const cotime = userCotimeNow;
  const other = sql`case when ${cotime.userA} = ${userId} then ${cotime.userB} else ${cotime.userA} end`;
  const [[stats], [coUser]] = await Promise.all([
    db
      .select({
        secondsWatched: userStatsNow.secondsWatched,
        secondsStreamed: userStatsNow.secondsStreamed,
        roomsJoined: userStatsNow.roomsJoined,
      })
      .from(userStatsNow.from)
      .where(eq(userStatsNow.userId, userId)),
    db
      .select({
        id: user.id,
        username,
        image: user.image,
        secondsTogether: cotime.secondsTogether,
      })
      .from(cotime.from)
      .innerJoin(user, eq(user.id, other))
      .where(
        and(or(eq(cotime.userA, userId), eq(cotime.userB, userId)), ne(cotime.secondsTogether, 0)),
      )
      .orderBy(desc(cotime.secondsTogether), asc(user.id))
      .limit(1),
  ]);
  return {
    hoursWatched: secondsToHours(stats?.secondsWatched ?? 0),
    hoursStreamed: secondsToHours(stats?.secondsStreamed ?? 0),
    roomsJoined: stats?.roomsJoined ?? 0,
    topCoUser: coUser ?? null,
  };
}
