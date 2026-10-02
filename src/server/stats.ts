/**
 * Stats roll-up and retention purge (ADR 11).
 *
 * When a room ends its presence/stream intervals (clamped and merged by
 * ./intervals.ts, the same way recaps read them) are folded into the
 * persistent aggregates (user_stats, user_cotime, daily_platform_stats). The
 * daily purge rolls up anything missed and then hard-deletes rooms that ended
 * more than 30 days ago; room-scoped tables go with them via ON DELETE CASCADE.
 *
 * Reads add the rooms not yet rolled up (live, or ended and awaiting roll-up) to
 * the stored totals (`userStatsNow` and friends), computing them with the same
 * SQL as the roll-up. The roll-up stays the only write.
 *
 * The per-user aggregates and co-time are stored over every room and again over public rooms
 * only (`public_*`, ADR 16 addendum). `userStatsNow` and `userCotimeNow` read all rooms, for
 * admins and anonymous platform totals; `publicUserStatsNow` and `publicUserCotimeNow` read
 * public rooms only, for everyone else (`userStatsVisibleTo` picks by caller).
 *
 * All functions take a driver-agnostic `Db`, so they run against postgres-js
 * in production and PGlite in tests.
 */
import { and, eq, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, rooms } from "../db/schema/index.ts";
import type { Caller } from "./caller.ts";
import { inRoom, mergedIntervals, roomTimes, seconds } from "./intervals.ts";

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type Executor = Pick<Db, "execute" | "insert">;

/** The UTC day of `at`, as `YYYY-MM-DD` (the daily counters' key). */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function bumpDaily(
  db: Executor,
  at: Date,
  column: "newUsers" | "roomsCreated" | "roomsEnded",
): Promise<void> {
  await db
    .insert(dailyPlatformStats)
    .values({ day: utcDay(at), [column]: 1 })
    .onConflictDoUpdate({
      target: dailyPlatformStats.day,
      set: { [column]: sql`${dailyPlatformStats[column]} + 1` },
    });
}

/** Count a sign-up in the daily platform counters. */
export async function recordNewUser(db: Executor, at: Date = new Date()): Promise<void> {
  await bumpDaily(db, at, "newUsers");
}

/** The rooms not yet folded into the stored stats: live ones, and ended ones awaiting roll-up. */
const unrolledRooms = sql`r.stats_rolled_up_at is null`;

/** Which rooms a read counts: every room, or public ones only (ADR 16 addendum). */
type StatsView = "all" | "public";

/** The rooms of `view` among those of `scope`. */
const inView = (view: StatsView, scope: SQL): SQL =>
  view === "public" ? sql`(${scope}) and not r.is_private` : scope;

type StoredColumn =
  | "seconds_streamed"
  | "seconds_watched"
  | "rooms_hosted"
  | "rooms_joined"
  | "peak_viewers"
  | "seconds_together";

/** The stored column of `column` for `view`: `public_<column>` over public rooms only. */
const stored = (view: StatsView, column: StoredColumn): SQL =>
  sql.raw(view === "public" ? `public_${column}` : column);

/**
 * CTE fragment: what the rooms of `scope` add to each user's stats. Defines
 * `contribution(user_id, streamed, watched, hosted, joined, peak)`, summed over the
 * rooms (peak: the largest), for users that exist. Built on `roomTimes`, so open
 * intervals count up to their last-seen checkpoint.
 *
 * - streamed: time streaming in the room.
 * - watched: time present in the room minus the user's own streaming time.
 * - joined: +1 for everyone with presence.
 * - hosted: +1 for everyone who held host (host_intervals); the creator if none were logged.
 * - peak: most other users present at once during any of the user's streams.
 */
function userContributions(scope: SQL): SQL {
  return sql`
    ${roomTimes(scope)},
    hosts as (
      select h.room_id, h.user_id
      from host_intervals h join rooms r on r.id = h.room_id
      where ${scope}
      union
      select r.id, r.created_by
      from rooms r
      where ${scope}
        and r.created_by is not null
        and not exists (select 1 from host_intervals h where h.room_id = r.id)
    ),
    -- Max concurrency inside a stream span is reached at its start or at
    -- some other user's arrival within it, so only those points are checked.
    points as (
      select st.room_id, st.user_id, st.s, st.e, st.s as t from st
      union
      select st.room_id, st.user_id, st.s, st.e, p.s as t
      from st join p
        on p.room_id = st.room_id and p.s > st.s and p.s < st.e and p.user_id <> st.user_id
    ),
    concurrency as (
      select pt.room_id, pt.user_id, count(distinct p.user_id) as viewers
      from points pt
      left join p
        on p.room_id = pt.room_id and p.user_id <> pt.user_id and p.s <= pt.t and p.e > pt.t
      group by pt.room_id, pt.user_id, pt.s, pt.t
    ),
    peak as (
      select room_id, user_id, max(viewers)::int as viewers
      from concurrency group by room_id, user_id
    ),
    per_room as (
      select user_id, 0::bigint as streamed, secs as watched, 0 as hosted, 1 as joined, 0 as peak
      from watched
      union all
      select s.user_id, s.secs, 0, 0, 0, coalesce(pk.viewers, 0)
      from streamed s left join peak pk on pk.room_id = s.room_id and pk.user_id = s.user_id
      union all
      select user_id, 0, 0, 1, 0, 0 from hosts
    ),
    contribution as (
      select c.user_id, sum(c.streamed) as streamed, sum(c.watched) as watched,
             sum(c.hosted) as hosted, sum(c.joined) as joined, max(c.peak) as peak
      from per_room c join "user" u on u.id = c.user_id
      group by c.user_id
    )`;
}

/**
 * CTE fragment: pairwise co-time in the rooms of `scope`. Defines
 * `pair_contribution(user_a, user_b, secs)` with user_a < user_b: the overlap of their
 * presence spans, whole seconds per room, summed over the rooms.
 */
function pairContributions(scope: SQL): SQL {
  return sql`
    ${mergedIntervals("p", "presence_intervals", scope)},
    room_pairs as (
      select a.user_id as user_a, b.user_id as user_b,
             ${seconds(sql`least(a.e, b.e) - greatest(a.s, b.s)`)} as secs
      from p a join p b
        on b.room_id = a.room_id and a.user_id < b.user_id and a.s < b.e and b.s < a.e
      group by a.room_id, a.user_id, b.user_id
    ),
    pair_contribution as (
      select user_a, user_b, sum(secs) as secs
      from room_pairs where secs > 0
      group by user_a, user_b
    )`;
}

/**
 * Every user's stats as read: `user_stats` plus the contribution of the rooms not yet
 * rolled up, worked out by the same SQL as the roll-up, so a room's numbers don't
 * change when it rolls up. `from` is a subquery source and the rest are its columns;
 * a user with no stats has no row (so null when left-joined). `view` picks every room
 * or public rooms only.
 */
function userStatsRead(view: StatsView) {
  return {
    from: sql`(
    with ${userContributions(inView(view, unrolledRooms))}
    select user_id,
           sum(seconds_streamed)::bigint as seconds_streamed,
           sum(seconds_watched)::bigint as seconds_watched,
           sum(rooms_hosted)::int as rooms_hosted,
           sum(rooms_joined)::int as rooms_joined,
           max(peak_viewers)::int as peak_viewers
    from (
      select user_id, ${stored(view, "seconds_streamed")} as seconds_streamed,
             ${stored(view, "seconds_watched")} as seconds_watched,
             ${stored(view, "rooms_hosted")} as rooms_hosted,
             ${stored(view, "rooms_joined")} as rooms_joined,
             ${stored(view, "peak_viewers")} as peak_viewers
      from user_stats
      union all
      select user_id, streamed, watched, hosted, joined, peak from contribution
    ) all_stats
    group by user_id
  ) as user_stats_now`,
    userId: sql<string>`user_stats_now.user_id`,
    secondsStreamed: sql<number | null>`user_stats_now.seconds_streamed`.mapWith(Number),
    secondsWatched: sql<number | null>`user_stats_now.seconds_watched`.mapWith(Number),
    roomsHosted: sql<number | null>`user_stats_now.rooms_hosted`.mapWith(Number),
    roomsJoined: sql<number | null>`user_stats_now.rooms_joined`.mapWith(Number),
    peakViewers: sql<number | null>`user_stats_now.peak_viewers`.mapWith(Number),
  };
}

/** Pairwise co-time as read: `user_cotime` plus the rooms not yet rolled up. See `userStatsRead`. */
function userCotimeRead(view: StatsView) {
  return {
    from: sql`(
    with ${pairContributions(inView(view, unrolledRooms))}
    select user_a, user_b, sum(seconds_together)::bigint as seconds_together
    from (
      select user_a, user_b, ${stored(view, "seconds_together")} as seconds_together
      from user_cotime
      union all
      select user_a, user_b, secs from pair_contribution
    ) all_pairs
    group by user_a, user_b
  ) as user_cotime_now`,
    userA: sql<string>`user_cotime_now.user_a`,
    userB: sql<string>`user_cotime_now.user_b`,
    secondsTogether: sql<number>`user_cotime_now.seconds_together`.mapWith(Number),
  };
}

/** Stats and co-time over every room, private ones included: for admins and platform totals. */
export const userStatsNow = userStatsRead("all");
export const userCotimeNow = userCotimeRead("all");

/** Stats and co-time over public rooms only: what a profile or search shows non-admins. */
export const publicUserStatsNow = userStatsRead("public");
export const publicUserCotimeNow = userCotimeRead("public");

/**
 * The stats `caller` may see: every room for an admin, public rooms only for anyone else (ADR 16
 * addendum). The stored aggregates don't record their rooms, so this can't follow the room
 * visibility of the viewer (`roomVisibleTo`), whose private rooms differ by member.
 */
export const userStatsVisibleTo = (caller: Caller) =>
  caller.role === "admin" ? userStatsNow : publicUserStatsNow;

/** Co-time `caller` may see, as `userStatsVisibleTo`. */
export const userCotimeVisibleTo = (caller: Caller) =>
  caller.role === "admin" ? userCotimeNow : publicUserCotimeNow;

/**
 * The daily platform counters as read: `daily_platform_stats` plus each room not yet
 * rolled up in `rooms_created` on its creation day. `rooms_ended` only moves at the
 * roll-up. See `userStatsNow`.
 */
export const dailyStatsNow = {
  from: sql`(
    select day, sum(new_users)::int as new_users, sum(rooms_created)::int as rooms_created,
           sum(rooms_ended)::int as rooms_ended
    from (
      select day, new_users, rooms_created, rooms_ended from daily_platform_stats
      union all
      select (r.created_at at time zone 'UTC')::date, 0, count(*), 0
      from rooms r
      where ${unrolledRooms}
      group by 1
    ) all_days
    group by day
  ) as daily_stats_now`,
  day: sql<string>`daily_stats_now.day::text`,
  newUsers: sql<number>`daily_stats_now.new_users`.mapWith(Number),
  roomsCreated: sql<number>`daily_stats_now.rooms_created`.mapWith(Number),
  roomsEnded: sql<number>`daily_stats_now.rooms_ended`.mapWith(Number),
};

/**
 * Fold an ended room's intervals into the persistent stats (`userContributions` and
 * `pairContributions` hold the maths). Idempotent: the room is claimed by setting
 * `stats_rolled_up_at` in the same transaction, so a second call (or a concurrent
 * one) is a no-op. Returns whether this call did the roll-up. Rooms that haven't
 * ended are left alone. A private room is folded into the all-rooms columns only (a room's
 * privacy is fixed when it's created).
 */
export async function rollupEndedRoom(db: Db, roomId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [room] = await tx
      .update(rooms)
      .set({ statsRolledUpAt: now })
      .where(and(eq(rooms.id, roomId), isNotNull(rooms.endedAt), isNull(rooms.statsRolledUpAt)))
      .returning({
        createdAt: rooms.createdAt,
        endedAt: rooms.endedAt,
        isPrivate: rooms.isPrivate,
      });
    if (!room?.endedAt) return false;

    // A private room writes the all-rooms columns only; a public one writes both sets.
    const isPublic = !room.isPrivate;
    const none = sql``;
    await tx.execute(sql`
      with ${userContributions(inRoom(roomId))}
      insert into user_stats
        (user_id, seconds_streamed, seconds_watched, rooms_hosted, rooms_joined, peak_viewers
         ${
           isPublic
             ? sql`, public_seconds_streamed, public_seconds_watched, public_rooms_hosted,
                public_rooms_joined, public_peak_viewers`
             : none
         })
      select user_id, streamed, watched, hosted, joined, peak
             ${isPublic ? sql`, streamed, watched, hosted, joined, peak` : none}
      from contribution
      order by user_id
      on conflict (user_id) do update set
        seconds_streamed = user_stats.seconds_streamed + excluded.seconds_streamed,
        seconds_watched = user_stats.seconds_watched + excluded.seconds_watched,
        rooms_hosted = user_stats.rooms_hosted + excluded.rooms_hosted,
        rooms_joined = user_stats.rooms_joined + excluded.rooms_joined,
        peak_viewers = greatest(user_stats.peak_viewers, excluded.peak_viewers)
        ${
          isPublic
            ? sql`,
        public_seconds_streamed =
          user_stats.public_seconds_streamed + excluded.public_seconds_streamed,
        public_seconds_watched = user_stats.public_seconds_watched + excluded.public_seconds_watched,
        public_rooms_hosted = user_stats.public_rooms_hosted + excluded.public_rooms_hosted,
        public_rooms_joined = user_stats.public_rooms_joined + excluded.public_rooms_joined,
        public_peak_viewers = greatest(user_stats.public_peak_viewers, excluded.public_peak_viewers)`
            : none
        }
    `);

    await tx.execute(sql`
      with ${pairContributions(inRoom(roomId))}
      insert into user_cotime
        (user_a, user_b, seconds_together ${isPublic ? sql`, public_seconds_together` : none})
      select user_a, user_b, secs ${isPublic ? sql`, secs` : none}
      from pair_contribution
      order by user_a, user_b
      on conflict (user_a, user_b) do update set
        seconds_together = user_cotime.seconds_together + excluded.seconds_together
        ${
          isPublic
            ? sql`, public_seconds_together =
          user_cotime.public_seconds_together + excluded.public_seconds_together`
            : none
        }
    `);

    await bumpDaily(tx, room.createdAt, "roomsCreated");
    await bumpDaily(tx, room.endedAt, "roomsEnded");
    return true;
  });
}

export interface PurgeResult {
  rolledUp: number;
  purged: number;
}

/**
 * Daily retention job: roll up any ended room that was missed, then delete
 * rooms that ended more than RETENTION_DAYS ago. Stats tables have no FK to
 * rooms, so they survive the delete. A room whose roll-up fails is logged and
 * skipped, so one bad room can't stop retention; it stays un-rolled-up (and is
 * never deleted) and is retried on the next run.
 */
export async function purgeExpiredRooms(db: Db, now: Date = new Date()): Promise<PurgeResult> {
  const pending = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(isNotNull(rooms.endedAt), isNull(rooms.statsRolledUpAt)));

  let rolledUp = 0;
  for (const { id } of pending) {
    try {
      if (await rollupEndedRoom(db, id, now)) rolledUp++;
    } catch (error) {
      console.error(`[maintenance] roll-up of room ${id} failed, skipping`, error);
    }
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(rooms)
    .where(and(lt(rooms.endedAt, cutoff), isNotNull(rooms.statsRolledUpAt)))
    .returning({ id: rooms.id });

  return { rolledUp, purged: deleted.length };
}
