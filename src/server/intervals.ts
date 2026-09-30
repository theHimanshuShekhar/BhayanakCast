/**
 * How a room's presence and stream intervals become time (ADRs 11, 12). The
 * stats roll-up (./stats.ts) and recaps (./recaps.ts) both build on these CTE
 * fragments, so a recap's minutes always agree with the stats it rolls into.
 *
 * - Open intervals are closed at their last-seen checkpoint (ADR 12). In a room that
 *   hasn't ended that is where a live room's time stops, until the next checkpoint.
 * - Everything is clamped to the room's end, when it has one.
 * - Each user's overlapping or touching spans are merged, so nothing counts twice.
 * - Watched = present minus the user's own streaming (ADR 11 stat definitions).
 */
import { type SQL, sql } from "drizzle-orm";

/**
 * A room set for the fragments below: a condition on `rooms`, which they alias as `r`.
 * Spans never cross rooms, so any number of rooms can be computed in one pass.
 */
export const inRoom = (roomId: string) => sql`r.id = ${roomId}`;

/**
 * CTE fragment producing `<name>(room_id, user_id, s, e)`: one row per user per
 * continuous span in each room of `scope`, clamped and merged as described above.
 */
export function mergedIntervals(
  name: string,
  table: "presence_intervals" | "stream_intervals",
  scope: SQL,
): SQL {
  const n = sql.raw(name);
  const t = sql.raw(table);
  return sql`
    ${n}_raw as (
      select i.room_id, i.user_id, i.started_at as s,
             least(coalesce(i.ended_at, i.last_seen_at), r.ended_at) as e
      from ${t} i join rooms r on r.id = i.room_id
      where ${scope}
    ),
    ${n}_ord as (
      select room_id, user_id, s, e,
             max(e) over (partition by room_id, user_id order by s, e
                          rows between unbounded preceding and 1 preceding) as prev_e
      from ${n}_raw where e > s
    ),
    ${n}_grp as (
      select room_id, user_id, s, e,
             sum(case when prev_e >= s then 0 else 1 end)
               over (partition by room_id, user_id order by s, e) as grp
      from ${n}_ord
    ),
    ${n} as (
      select room_id, user_id, min(s) as s, max(e) as e
      from ${n}_grp group by room_id, user_id, grp
    )`;
}

/** Whole seconds in the sum of an interval expression, as the stats store them. */
export const seconds = (expr: SQL) => sql`floor(sum(extract(epoch from ${expr})))::bigint`;

/**
 * CTE fragment for each room of `scope`'s time per user, whole seconds per room. Defines:
 * - `p(room_id, user_id, s, e)`: merged presence spans; `st(...)`: merged stream spans.
 * - `present(room_id, user_id, secs)`: time in the room, for everyone with presence.
 * - `streamed(room_id, user_id, secs)`: time streaming, for everyone who streamed.
 * - `watched(room_id, user_id, secs)`: time present minus own streaming, for everyone with
 *   presence.
 */
export function roomTimes(scope: SQL): SQL {
  return sql`
    ${mergedIntervals("p", "presence_intervals", scope)},
    ${mergedIntervals("st", "stream_intervals", scope)},
    present as (
      select room_id, user_id, ${seconds(sql`e - s`)} as secs from p group by room_id, user_id
    ),
    streamed as (
      select room_id, user_id, ${seconds(sql`e - s`)} as secs from st group by room_id, user_id
    ),
    -- Spans are merged per user, so own presence ∩ own stream never double counts.
    self_streamed as (
      select p.room_id, p.user_id,
             ${seconds(sql`least(p.e, st.e) - greatest(p.s, st.s)`)} as secs
      from p join st on st.room_id = p.room_id and st.user_id = p.user_id
                    and st.s < p.e and p.s < st.e
      group by p.room_id, p.user_id
    ),
    watched as (
      select pr.room_id, pr.user_id, greatest(pr.secs - coalesce(ss.secs, 0), 0) as secs
      from present pr
      left join self_streamed ss on ss.room_id = pr.room_id and ss.user_id = pr.user_id
    )`;
}
