/**
 * Stats roll-up and retention purge (ADR 11).
 *
 * When a room ends its presence/stream intervals are folded into the
 * persistent aggregates (user_stats, user_cotime, daily_platform_stats). The
 * daily purge rolls up anything missed and then hard-deletes rooms that ended
 * more than 30 days ago; room-scoped tables go with them via ON DELETE CASCADE.
 *
 * All functions take a driver-agnostic `Db`, so they run against postgres-js
 * in production and PGlite in tests.
 */
import { and, eq, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { dailyPlatformStats, rooms } from "../db/schema/index.ts";

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type Executor = Pick<Db, "execute" | "insert">;

function utcDay(at: Date): string {
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

/**
 * CTE fragment producing `<name>(user_id, s, e)`: one row per user per
 * continuous span in the room. Open intervals are closed at their last-seen
 * checkpoint (ADR 12); everything is clamped to the room's end; and each user's
 * overlapping or touching spans are merged so nothing is counted twice.
 */
function mergedIntervals(
  name: string,
  table: "presence_intervals" | "stream_intervals",
  roomId: string,
): SQL {
  const n = sql.raw(name);
  const t = sql.raw(table);
  return sql`
    ${n}_raw as (
      select i.user_id, i.started_at as s,
             least(coalesce(i.ended_at, i.last_seen_at), r.ended_at) as e
      from ${t} i join rooms r on r.id = i.room_id
      where i.room_id = ${roomId}
    ),
    ${n}_ord as (
      select user_id, s, e,
             max(e) over (partition by user_id order by s, e
                          rows between unbounded preceding and 1 preceding) as prev_e
      from ${n}_raw where e > s
    ),
    ${n}_grp as (
      select user_id, s, e,
             sum(case when prev_e >= s then 0 else 1 end)
               over (partition by user_id order by s, e) as grp
      from ${n}_ord
    ),
    ${n} as (
      select user_id, min(s) as s, max(e) as e from ${n}_grp group by user_id, grp
    )`;
}

const seconds = (expr: SQL) => sql`floor(sum(extract(epoch from ${expr})))::bigint`;

/**
 * Fold an ended room's intervals into the persistent stats. Idempotent: the
 * room is claimed by setting `stats_rolled_up_at` in the same transaction, so a
 * second call (or a concurrent one) is a no-op. Returns whether this call did
 * the roll-up. Rooms that haven't ended are left alone.
 *
 * - secondsWatched: time present in the room minus the user's own streaming time.
 * - secondsStreamed: time streaming in the room.
 * - roomsJoined: +1 for everyone with presence.
 * - roomsHosted: +1 for everyone who held host (host_intervals); the creator if none were logged.
 * - peakViewers: most other users present at once during any of the user's streams.
 * - co-time: pairwise overlap of presence spans.
 */
export async function rollupEndedRoom(db: Db, roomId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [room] = await tx
      .update(rooms)
      .set({ statsRolledUpAt: now })
      .where(and(eq(rooms.id, roomId), isNotNull(rooms.endedAt), isNull(rooms.statsRolledUpAt)))
      .returning({
        createdBy: rooms.createdBy,
        createdAt: rooms.createdAt,
        endedAt: rooms.endedAt,
      });
    if (!room?.endedAt) return false;

    await tx.execute(sql`
      with ${mergedIntervals("p", "presence_intervals", roomId)},
      ${mergedIntervals("st", "stream_intervals", roomId)},
      present as (
        select user_id, ${seconds(sql`e - s`)} as secs from p group by user_id
      ),
      streamed as (
        select user_id, ${seconds(sql`e - s`)} as secs from st group by user_id
      ),
      -- Spans are merged per user, so own presence ∩ own stream never double counts.
      self_streamed as (
        select p.user_id, ${seconds(sql`least(p.e, st.e) - greatest(p.s, st.s)`)} as secs
        from p join st on st.user_id = p.user_id and st.s < p.e and p.s < st.e
        group by p.user_id
      ),
      watched as (
        select pr.user_id, greatest(pr.secs - coalesce(ss.secs, 0), 0) as secs
        from present pr left join self_streamed ss on ss.user_id = pr.user_id
      ),
      hosts as (
        select distinct user_id from host_intervals where room_id = ${roomId}
        union
        select ${room.createdBy}::text
        where ${room.createdBy}::text is not null
          and not exists (select 1 from host_intervals where room_id = ${roomId})
      ),
      -- Max concurrency inside a stream span is reached at its start or at
      -- some other user's arrival within it, so only those points are checked.
      points as (
        select st.user_id, st.s, st.e, st.s as t from st
        union
        select st.user_id, st.s, st.e, p.s as t
        from st join p on p.s > st.s and p.s < st.e and p.user_id <> st.user_id
      ),
      concurrency as (
        select pt.user_id, count(distinct p.user_id) as viewers
        from points pt
        left join p on p.user_id <> pt.user_id and p.s <= pt.t and p.e > pt.t
        group by pt.user_id, pt.s, pt.t
      ),
      peak as (
        select user_id, max(viewers)::int as viewers from concurrency group by user_id
      ),
      contributions as (
        select user_id, 0::bigint as streamed, secs as watched, 0 as hosted, 1 as joined, 0 as peak
        from watched
        union all
        select s.user_id, s.secs, 0, 0, 0, coalesce(pk.viewers, 0)
        from streamed s left join peak pk on pk.user_id = s.user_id
        union all
        select user_id, 0, 0, 1, 0, 0 from hosts
      )
      insert into user_stats
        (user_id, seconds_streamed, seconds_watched, rooms_hosted, rooms_joined, peak_viewers)
      select c.user_id, sum(c.streamed), sum(c.watched), sum(c.hosted), sum(c.joined), max(c.peak)
      from contributions c join "user" u on u.id = c.user_id
      group by c.user_id
      on conflict (user_id) do update set
        seconds_streamed = user_stats.seconds_streamed + excluded.seconds_streamed,
        seconds_watched = user_stats.seconds_watched + excluded.seconds_watched,
        rooms_hosted = user_stats.rooms_hosted + excluded.rooms_hosted,
        rooms_joined = user_stats.rooms_joined + excluded.rooms_joined,
        peak_viewers = greatest(user_stats.peak_viewers, excluded.peak_viewers)
    `);

    await tx.execute(sql`
      with ${mergedIntervals("p", "presence_intervals", roomId)},
      pairs as (
        select a.user_id as user_a, b.user_id as user_b,
               ${seconds(sql`least(a.e, b.e) - greatest(a.s, b.s)`)} as secs
        from p a join p b on a.user_id < b.user_id and a.s < b.e and b.s < a.e
        group by a.user_id, b.user_id
      )
      insert into user_cotime (user_a, user_b, seconds_together)
      select user_a, user_b, secs from pairs where secs > 0
      on conflict (user_a, user_b) do update set
        seconds_together = user_cotime.seconds_together + excluded.seconds_together
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
 * rooms, so they survive the delete.
 */
export async function purgeExpiredRooms(db: Db, now: Date = new Date()): Promise<PurgeResult> {
  const pending = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(isNotNull(rooms.endedAt), isNull(rooms.statsRolledUpAt)));

  let rolledUp = 0;
  for (const { id } of pending) {
    if (await rollupEndedRoom(db, id, now)) rolledUp++;
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(rooms)
    .where(and(lt(rooms.endedAt, cutoff), isNotNull(rooms.statsRolledUpAt)))
    .returning({ id: rooms.id });

  return { rolledUp, purged: deleted.length };
}
