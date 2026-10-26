/**
 * Home summary, server half: the sidebar's "Right Now", "Regulars" and "Community" numbers, and
 * the "You" card. Takes the database and the caller explicitly, like src/server/rooms.ts, so the
 * server function is a thin wrapper and tests call this against PGlite.
 *
 * "Right Now" counts over the live rooms the caller may see, the same way
 * `listLiveRooms` does (open presence and stream intervals of live, visible rooms),
 * so the panel agrees with the Live Now list. "Community" sums the persistent
 * per-user stats plus the rooms in progress over every room, private ones included
 * (`userStatsNow`): anonymous totals that name no room or user, so they're the same for
 * every caller (ADR 16 addendum). "Regulars" names people, so it counts public rooms only
 * (`publicUserStatsNow`) for every caller, admins included: one list for everyone, and the
 * summary's cache key needs no user. "Records" names rooms and a person, so it is public-only
 * for every caller in the same way. `getYouCard` is the caller's own figures, also over every
 * room, read apart from the summary so they get a cache key of their own.
 */
import { and, asc, count, desc, eq, gt, isNull, ne, or, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { presenceIntervals, rooms, streamIntervals, user } from "../db/schema/index.ts";
import {
  type CommunityTotals,
  type HomeSummary,
  REGULARS_LIMIT,
  type Records,
  type Regular,
  type RightNow,
  type YouCard,
} from "../lib/home.ts";
import { secondsToHours } from "../lib/profiles.ts";
import type { Caller } from "./caller.ts";
import { mergedIntervals } from "./intervals.ts";
import { username } from "./profiles.ts";
import { endedWithinRetention, minutesBetween } from "./rooms.ts";
import { publicUserStatsNow, userCotimeNow, userStatsNow } from "./stats.ts";
import { roomVisibleTo } from "./visibility.ts";

/** The sidebar numbers as `caller` sees them. */
export async function getHomeSummary(
  db: Db,
  caller: Caller,
  now: Date = new Date(),
): Promise<HomeSummary> {
  const [rightNow, regulars, records, community] = await Promise.all([
    rightNowCounts(db, caller),
    topRegulars(db),
    topRecords(db, now),
    communityTotals(db),
  ]);
  return { rightNow, regulars, records, community };
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

/**
 * The `REGULARS_LIMIT` people with the most public-room time (hours streamed plus watched),
 * rooms in progress included, most first; ties go to the lowest id. Nobody without public time.
 */
async function topRegulars(db: Db): Promise<Regular[]> {
  const stats = publicUserStatsNow;
  const seconds = sql<number>`coalesce(${stats.secondsStreamed}, 0) + coalesce(${stats.secondsWatched}, 0)`;
  const rows = await db
    .select({ id: user.id, username, image: user.image, seconds: seconds.mapWith(Number) })
    .from(stats.from)
    .innerJoin(user, eq(user.id, stats.userId))
    .where(sql`${seconds} > 0`)
    .orderBy(desc(seconds), asc(user.id))
    .limit(REGULARS_LIMIT);
  return rows.map(({ seconds, ...person }) => ({ ...person, hours: secondsToHours(seconds) }));
}

/**
 * The three records, over public rooms only for every caller. Ties go to the room that ended
 * last, then the lowest id (the user with the lowest id for viewers), so the same data always
 * names the same winner.
 */
async function topRecords(db: Db, now: Date): Promise<Records> {
  const [longestRoom, biggestRoom, mostViewers] = await Promise.all([
    longestPublicRoom(db, now),
    biggestPublicRoom(db, now),
    mostPublicViewers(db),
  ]);
  return { longestRoom, biggestRoom, mostViewers };
}

/** Public past streams in the retention window: the one rule for what a room record may count. */
const publicPastRooms = (now: Date) => and(eq(rooms.isPrivate, false), endedWithinRetention(now));

/** The public past stream in the retention window that lasted longest, as a past card counts it. */
async function longestPublicRoom(db: Db, now: Date): Promise<Records["longestRoom"]> {
  const [row] = await db
    .select({ id: rooms.id, name: rooms.name, createdAt: rooms.createdAt, endedAt: rooms.endedAt })
    .from(rooms)
    // A room nobody entered ends at its creation (ADR 14): no record at zero minutes.
    .where(and(publicPastRooms(now), sql`${rooms.endedAt} > ${rooms.createdAt}`))
    .orderBy(desc(sql`${rooms.endedAt} - ${rooms.createdAt}`), desc(rooms.endedAt), asc(rooms.id))
    .limit(1);
  if (!row?.endedAt) return null;
  return {
    id: row.id,
    name: row.name,
    durationMinutes: minutesBetween(row.createdAt, row.endedAt),
  };
}

/**
 * The public past stream in the retention window with the most people present at once. Presence
 * spans are clamped and merged per user (`mergedIntervals`, as the stats do), then a sweep over
 * their starts and ends keeps a running count per room: O(n log n) in the window's spans, not
 * the pairwise self-join the admin table uses. At a shared instant a leave counts before an
 * arrival, so back-to-back visitors are never together. The window is the rooms subquery (typed
 * columns), so no JS `Date` meets raw SQL.
 */
async function biggestPublicRoom(db: Db, now: Date): Promise<Records["biggestRoom"]> {
  const window = db.select({ id: rooms.id }).from(rooms).where(publicPastRooms(now));
  const biggest = sql`(
    with ${mergedIntervals("p", "presence_intervals", sql`r.id in (${window})`)},
    edges as (
      select room_id, s as t, 1 as d from p
      union all
      select room_id, e, -1 from p
    ),
    running as (
      select room_id, sum(d) over (partition by room_id order by t, d) as n from edges
    )
    select r.id, r.name, max(running.n) as people
    from running join rooms r on r.id = running.room_id
    group by r.id
    order by people desc, r.ended_at desc, r.id asc
    limit 1
  ) as biggest`;
  const [row] = await db
    .select({
      id: sql<string>`biggest.id`,
      name: sql<string>`biggest.name`,
      people: sql<number>`biggest.people`.mapWith(Number),
    })
    .from(biggest);
  return row ?? null;
}

/** The user with the highest public peak viewers, rooms in progress included; none at zero. */
async function mostPublicViewers(db: Db): Promise<Records["mostViewers"]> {
  const stats = publicUserStatsNow;
  const [row] = await db
    .select({ id: user.id, username, image: user.image, viewers: stats.peakViewers })
    .from(stats.from)
    .innerJoin(user, eq(user.id, stats.userId))
    .where(gt(stats.peakViewers, 0))
    .orderBy(desc(stats.peakViewers), asc(user.id))
    .limit(1);
  if (!row) return null;
  const { viewers, ...streamer } = row;
  return { streamer, viewers: viewers ?? 0 };
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
