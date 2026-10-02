/**
 * Admin dashboard, server half (ADRs 6, 11). Every function takes the database and
 * the caller explicitly, like src/server/rooms.ts, and refuses anyone without the
 * admin role before reading anything; the /admin route guard is UX only.
 *
 * - All-time totals come from the user table and the persistent `user_stats`, plus the
 *   rooms in progress (./stats.ts).
 * - The 30-day numbers and charts come from `daily_platform_stats` (UTC days). Those
 *   counters are bumped at sign-up and at the stats roll-up of an ended room; a room not
 *   yet rolled up is added to `rooms_created` on its creation day when read, so it counts
 *   as created while live and `rooms_ended` only moves once it has ended and rolled up.
 * - Room tables read `rooms` and presence intervals, so they reach back 30 days only.
 *   Admins see every room, private ones included (`roomVisibleTo`).
 */
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { type dailyPlatformStats, presenceIntervals, rooms, user } from "../db/schema/index.ts";
import {
  ADMIN_ROOMS_PAGE_SIZE,
  ADMIN_WINDOW_DAYS,
  type AdminLeaderboards,
  type AdminOverview,
  type AdminRecentRoomsPage,
  type DailyPoint,
  LEADERBOARD_SIZE,
  type LeaderboardEntry,
  type ListAdminRecentRoomsInput,
  listAdminRecentRoomsInput,
  type WindowCount,
} from "../lib/admin.ts";
import { secondsToHours } from "../lib/profiles.ts";
import type { LiveRoomCard } from "../lib/rooms.ts";
import { type Caller, requireAdmin } from "./caller.ts";
import { total } from "./home.ts";
import { escapeLike, username } from "./profiles.ts";
import {
  endedWithinRetention,
  listLiveRooms,
  minutesBetween,
  selectRooms,
  toSummary,
  usernameOf,
} from "./rooms.ts";
import { dailyStatsNow, userStatsNow, utcDay } from "./stats.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day `days` before `now`'s. */
const daysBefore = (now: Date, days: number) => utcDay(new Date(now.getTime() - days * DAY_MS));

type Counters = Omit<typeof dailyPlatformStats.$inferSelect, "day">;

/** Counter rows from `firstDay` through `now`'s day, by day. */
async function countersSince(db: Db, firstDay: string, now: Date) {
  const rows = await db
    .select({
      day: dailyStatsNow.day,
      newUsers: dailyStatsNow.newUsers,
      roomsCreated: dailyStatsNow.roomsCreated,
      roomsEnded: dailyStatsNow.roomsEnded,
    })
    .from(dailyStatsNow.from)
    .where(and(gte(dailyStatsNow.day, firstDay), lte(dailyStatsNow.day, utcDay(now))));
  return new Map<string, Counters>(rows.map(({ day, ...counters }) => [day, counters]));
}

async function userCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user);
  return row?.n ?? 0;
}

/** The stat cards: all-time totals and the last 30 days against the 30 before. */
export async function getAdminOverview(
  db: Db,
  caller: Caller,
  now: Date = new Date(),
): Promise<AdminOverview> {
  requireAdmin(caller);
  const windowStart = daysBefore(now, ADMIN_WINDOW_DAYS - 1);
  const [users, [stats], [live], counters] = await Promise.all([
    userCount(db),
    db
      .select({
        secondsStreamed: total(userStatsNow.secondsStreamed),
        secondsWatched: total(userStatsNow.secondsWatched),
        roomsHosted: total(userStatsNow.roomsHosted),
      })
      .from(userStatsNow.from),
    db.select({ n: count() }).from(rooms).where(isNull(rooms.endedAt)),
    countersSince(db, daysBefore(now, 2 * ADMIN_WINDOW_DAYS - 1), now),
  ]);
  const windowCount = (column: keyof Counters): WindowCount => {
    const result = { current: 0, previous: 0 };
    for (const [day, row] of counters) {
      result[day >= windowStart ? "current" : "previous"] += row[column];
    }
    return result;
  };
  return {
    totals: {
      users,
      hoursStreamed: secondsToHours(stats?.secondsStreamed ?? 0),
      hoursWatched: secondsToHours(stats?.secondsWatched ?? 0),
      roomsHosted: stats?.roomsHosted ?? 0,
      liveRooms: live?.n ?? 0,
    },
    window: {
      newUsers: windowCount("newUsers"),
      roomsCreated: windowCount("roomsCreated"),
      roomsEnded: windowCount("roomsEnded"),
    },
  };
}

/** The last 30 UTC days of platform counters, oldest first, with missing days as zeros. */
export async function getAdminDailySeries(
  db: Db,
  caller: Caller,
  now: Date = new Date(),
): Promise<DailyPoint[]> {
  requireAdmin(caller);
  const days = Array.from({ length: ADMIN_WINDOW_DAYS }, (_, i) =>
    daysBefore(now, ADMIN_WINDOW_DAYS - 1 - i),
  );
  const [counters, users] = await Promise.all([
    countersSince(db, days[0] ?? utcDay(now), now),
    userCount(db),
  ]);
  const points = days.map((day) => ({
    day,
    newUsers: 0,
    roomsCreated: 0,
    roomsEnded: 0,
    ...counters.get(day),
    cumulativeUsers: 0,
  }));
  // Walk back from today's total, taking off each later day's sign-ups.
  let cumulative = users;
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (!point) continue;
    point.cumulativeUsers = Math.max(0, cumulative);
    cumulative -= point.newUsers;
  }
  return points;
}

/** Every live room, private ones included, newest first. */
export async function listAdminLiveRooms(db: Db, caller: Caller): Promise<LiveRoomCard[]> {
  requireAdmin(caller);
  return listLiveRooms(db, caller);
}

/**
 * Most people present at once in each of `roomIds` (one page of rooms: the self-join below is
 * quadratic in a room's intervals). A presence interval counts until it ended; an open one
 * until the room ended at its last-seen checkpoint (ADR 12), or for good while the room is live.
 *
 * EXPLAIN ANALYZE on PGlite with 3000 rooms and 30,000 presence rows: the old `in` list of every
 * room was a Seq Scan of all presence rows and a 135,000-row self-join sorted on disk (260.8 ms);
 * a page of 25 rooms is a Bitmap Index Scan on `presence_intervals_room_idx` reading 250 rows,
 * sorted in memory (3.4 ms).
 */
async function peakPresence(db: Db, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map();
  const ids = sql.join(
    roomIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const concurrent = sql`(
    with spans as (
      select i.room_id, i.user_id, i.started_at as s,
             case
               when i.ended_at is not null
                 then least(i.ended_at, coalesce(r.ended_at, 'infinity'::timestamptz))
               when r.ended_at is null then 'infinity'::timestamptz
               else least(i.last_seen_at, r.ended_at)
             end as e
      from presence_intervals i join rooms r on r.id = i.room_id
      where i.room_id in (${ids})
    )
    select a.room_id, count(distinct b.user_id) as n
    from spans a
    join spans b on b.room_id = a.room_id and b.s <= a.s and b.e > a.s
    where a.e > a.s
    group by a.room_id, a.s
  ) as concurrent`;
  const rows = await db
    .select({
      roomId: sql<string>`concurrent.room_id`,
      peak: sql<number>`max(concurrent.n)`.mapWith(Number),
    })
    .from(concurrent)
    .groupBy(sql`concurrent.room_id`);
  return new Map(rows.map((row) => [row.roomId, row.peak]));
}

async function joinedCounts(db: Db, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map();
  const rows = await db
    .select({ roomId: presenceIntervals.roomId, n: countDistinct(presenceIntervals.userId) })
    .from(presenceIntervals)
    .where(inArray(presenceIntervals.roomId, roomIds))
    .groupBy(presenceIntervals.roomId);
  return new Map(rows.map((row) => [row.roomId, row.n]));
}

/**
 * A page of live rooms and rooms ended within the last 30 days, private ones included, whose
 * name or host's username contains `q` (case-insensitive): live first (newest first), then
 * most recently ended first. Peak and joined are computed for the page's rooms only. The table
 * sorts the page client-side.
 */
export async function listAdminRecentRooms(
  db: Db,
  caller: Caller,
  input: ListAdminRecentRoomsInput,
  now: Date = new Date(),
): Promise<AdminRecentRoomsPage> {
  requireAdmin(caller);
  const { q, page } = listAdminRecentRoomsInput.parse(input);
  const pattern = `%${escapeLike(q)}%`;
  const where = and(
    or(isNull(rooms.endedAt), endedWithinRetention(now)),
    q ? or(ilike(rooms.name, pattern), sql`${username} ilike ${pattern}`) : undefined,
  );
  const [rows, [totalRow]] = await Promise.all([
    selectRooms(db)
      .where(where)
      .orderBy(sql`${rooms.endedAt} desc nulls first`, desc(rooms.createdAt), asc(rooms.id))
      .limit(ADMIN_ROOMS_PAGE_SIZE)
      .offset((page - 1) * ADMIN_ROOMS_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(rooms)
      .leftJoin(user, eq(user.id, rooms.hostUserId))
      .where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const [peaks, joined] = await Promise.all([peakPresence(db, ids), joinedCounts(db, ids)]);
  return {
    rooms: rows.map((row) => {
      const { id, name, isPrivate, host, createdAt } = toSummary(row);
      return {
        id,
        name,
        isPrivate,
        host,
        status: row.endedAt ? "ended" : "live",
        peak: peaks.get(id) ?? 0,
        joined: joined.get(id) ?? 0,
        durationMinutes: minutesBetween(row.createdAt, row.endedAt ?? now),
        createdAt,
        endedAt: row.endedAt?.toISOString() ?? null,
      };
    }),
    total: totalRow?.n ?? 0,
    page,
    pageSize: ADMIN_ROOMS_PAGE_SIZE,
  };
}

async function topBy(
  db: Db,
  column: typeof userStatsNow.secondsStreamed | typeof userStatsNow.secondsWatched,
): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      discordUsername: user.discordUsername,
      image: user.image,
      seconds: column,
    })
    .from(userStatsNow.from)
    .innerJoin(user, eq(user.id, userStatsNow.userId))
    .where(gt(column, 0))
    .orderBy(desc(column), asc(user.id))
    .limit(LEADERBOARD_SIZE);
  return rows.map((row) => ({
    id: row.id,
    username: usernameOf(row),
    image: row.image,
    hours: secondsToHours(row.seconds ?? 0),
  }));
}

/** The top users by lifetime hours streamed and watched. */
export async function getAdminLeaderboards(db: Db, caller: Caller): Promise<AdminLeaderboards> {
  requireAdmin(caller);
  const [streamed, watched] = await Promise.all([
    topBy(db, userStatsNow.secondsStreamed),
    topBy(db, userStatsNow.secondsWatched),
  ]);
  return { streamed, watched };
}
