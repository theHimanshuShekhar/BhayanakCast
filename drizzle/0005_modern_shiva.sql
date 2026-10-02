ALTER TABLE "user_cotime" ADD COLUMN "public_seconds_together" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "public_seconds_streamed" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "public_seconds_watched" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "public_rooms_hosted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "public_rooms_joined" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "public_peak_viewers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
--
-- Backfill (ADR 16 addendum, #64). The stored aggregates don't record which rooms they came
-- from, so the public columns are recomputed from the rooms that still exist: public rooms
-- already rolled up (ended within the last 30 days), using a frozen copy of the roll-up's SQL
-- (src/server/stats.ts as of this migration). Rooms the 30-day purge already deleted can't be
-- told public from private, so their time stays out of the public columns (privacy first); the
-- all-rooms columns, which admins and platform totals read, keep it.
--
with
    p_raw as (
      select i.room_id, i.user_id, i.started_at as s,
             least(coalesce(i.ended_at, i.last_seen_at), r.ended_at) as e
      from presence_intervals i join rooms r on r.id = i.room_id
      where not r.is_private and r.stats_rolled_up_at is not null
    ),
    p_ord as (
      select room_id, user_id, s, e,
             max(e) over (partition by room_id, user_id order by s, e
                          rows between unbounded preceding and 1 preceding) as prev_e
      from p_raw where e > s
    ),
    p_grp as (
      select room_id, user_id, s, e,
             sum(case when prev_e >= s then 0 else 1 end)
               over (partition by room_id, user_id order by s, e) as grp
      from p_ord
    ),
    p as (
      select room_id, user_id, min(s) as s, max(e) as e
      from p_grp group by room_id, user_id, grp
    ),
    st_raw as (
      select i.room_id, i.user_id, i.started_at as s,
             least(coalesce(i.ended_at, i.last_seen_at), r.ended_at) as e
      from stream_intervals i join rooms r on r.id = i.room_id
      where not r.is_private and r.stats_rolled_up_at is not null
    ),
    st_ord as (
      select room_id, user_id, s, e,
             max(e) over (partition by room_id, user_id order by s, e
                          rows between unbounded preceding and 1 preceding) as prev_e
      from st_raw where e > s
    ),
    st_grp as (
      select room_id, user_id, s, e,
             sum(case when prev_e >= s then 0 else 1 end)
               over (partition by room_id, user_id order by s, e) as grp
      from st_ord
    ),
    st as (
      select room_id, user_id, min(s) as s, max(e) as e
      from st_grp group by room_id, user_id, grp
    ),
    present as (
      select room_id, user_id, floor(sum(extract(epoch from e - s)))::bigint as secs from p group by room_id, user_id
    ),
    streamed as (
      select room_id, user_id, floor(sum(extract(epoch from e - s)))::bigint as secs from st group by room_id, user_id
    ),
    -- Spans are merged per user, so own presence ∩ own stream never double counts.
    self_streamed as (
      select p.room_id, p.user_id,
             floor(sum(extract(epoch from least(p.e, st.e) - greatest(p.s, st.s))))::bigint as secs
      from p join st on st.room_id = p.room_id and st.user_id = p.user_id
                    and st.s < p.e and p.s < st.e
      group by p.room_id, p.user_id
    ),
    watched as (
      select pr.room_id, pr.user_id, greatest(pr.secs - coalesce(ss.secs, 0), 0) as secs
      from present pr
      left join self_streamed ss on ss.room_id = pr.room_id and ss.user_id = pr.user_id
    ),
    hosts as (
      select h.room_id, h.user_id
      from host_intervals h join rooms r on r.id = h.room_id
      where not r.is_private and r.stats_rolled_up_at is not null
      union
      select r.id, r.created_by
      from rooms r
      where not r.is_private and r.stats_rolled_up_at is not null
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
    )
update user_stats set
  public_seconds_streamed = c.streamed,
  public_seconds_watched = c.watched,
  public_rooms_hosted = c.hosted,
  public_rooms_joined = c.joined,
  public_peak_viewers = c.peak
from contribution c
where user_stats.user_id = c.user_id;
--> statement-breakpoint
with
    p_raw as (
      select i.room_id, i.user_id, i.started_at as s,
             least(coalesce(i.ended_at, i.last_seen_at), r.ended_at) as e
      from presence_intervals i join rooms r on r.id = i.room_id
      where not r.is_private and r.stats_rolled_up_at is not null
    ),
    p_ord as (
      select room_id, user_id, s, e,
             max(e) over (partition by room_id, user_id order by s, e
                          rows between unbounded preceding and 1 preceding) as prev_e
      from p_raw where e > s
    ),
    p_grp as (
      select room_id, user_id, s, e,
             sum(case when prev_e >= s then 0 else 1 end)
               over (partition by room_id, user_id order by s, e) as grp
      from p_ord
    ),
    p as (
      select room_id, user_id, min(s) as s, max(e) as e
      from p_grp group by room_id, user_id, grp
    ),
    room_pairs as (
      select a.user_id as user_a, b.user_id as user_b,
             floor(sum(extract(epoch from least(a.e, b.e) - greatest(a.s, b.s))))::bigint as secs
      from p a join p b
        on b.room_id = a.room_id and a.user_id < b.user_id and a.s < b.e and b.s < a.e
      group by a.room_id, a.user_id, b.user_id
    ),
    pair_contribution as (
      select user_a, user_b, sum(secs) as secs
      from room_pairs where secs > 0
      group by user_a, user_b
    )
update user_cotime set public_seconds_together = c.secs
from pair_contribution c
where user_cotime.user_a = c.user_a and user_cotime.user_b = c.user_b;
