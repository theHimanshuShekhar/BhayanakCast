/**
 * How a room's presence and stream intervals become time (ADRs 11, 12). The
 * stats roll-up (./stats.ts) and recaps (./recaps.ts) both build on these CTE
 * fragments, so a recap's minutes always agree with the stats it rolls into.
 *
 * - Open intervals are closed at their last-seen checkpoint (ADR 12).
 * - Everything is clamped to the room's end.
 * - Each user's overlapping or touching spans are merged, so nothing counts twice.
 * - Watched = present minus the user's own streaming (ADR 11 stat definitions).
 */
import { type SQL, sql } from "drizzle-orm";

/**
 * CTE fragment producing `<name>(user_id, s, e)`: one row per user per
 * continuous span in the room, clamped and merged as described above.
 */
export function mergedIntervals(
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

/** Whole seconds in the sum of an interval expression, as the stats store them. */
export const seconds = (expr: SQL) => sql`floor(sum(extract(epoch from ${expr})))::bigint`;

/**
 * CTE fragment for one room's time per user. Defines:
 * - `p(user_id, s, e)`: merged presence spans; `st(user_id, s, e)`: merged stream spans.
 * - `present(user_id, secs)`: time in the room, for everyone with presence.
 * - `streamed(user_id, secs)`: time streaming, for everyone who streamed.
 * - `watched(user_id, secs)`: time present minus own streaming, for everyone with presence.
 */
export function roomTimes(roomId: string): SQL {
  return sql`
    ${mergedIntervals("p", "presence_intervals", roomId)},
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
    )`;
}
