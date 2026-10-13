# 11. 30-day retention for room data; stats persist

Date: 2026-09-27 · Status: accepted

## Decision
- Room-level data (ended rooms, their join/leave and stream event logs, recap data, thumbnails) is kept for **30 days** after the room ends, then hard-deleted by a daily purge job.
- **Stats persist forever** as aggregates: per-user totals (hours streamed, hours watched, rooms hosted, rooms joined, peak viewers), pairwise co-time (seconds together), and the daily platform counters behind the admin charts.
- Aggregates are rolled up when a room ends (and defensively by the purge job before deleting), so purging never loses stats.
- Chat is never stored (ADR 4).

## Consequences
- "Past streams", recaps and the admin all-time rooms table only reach back 30 days; the UI should say so.
- Stats tables must not reference purged rows by foreign key.
- Purged rows can survive for up to 14 more days in the nightly backups (ADR 9 addendum).

## Addendum: stat definitions (2026-09-27)
- **Hours watched** = time present in a room *minus* that user's own stream intervals in it. Watched and streamed never overlap.
- **Hours streamed** = the sum of the user's stream intervals.
- **Rooms hosted**: every user who held the host role at any point in a room gets +1 for that room (at most once per room). This requires a host-interval log (`host_intervals`: roomId, userId, startedAt, endedAt), written by the realtime server on room creation and on each host transfer (ADR 14).

## Addendum: admin audit log (2026-09-29)
The admin audit log (`admin_actions`, ADR 6 addendum) is kept indefinitely, like stats. It is not room-level data: the purge never deletes it, and it references rooms and users by id only, never by foreign key.

## Addendum: stats include rooms in progress (2026-09-30)
The stats shown include rooms in progress. Every read of the per-user aggregates (hours streamed and watched, rooms hosted and joined, peak viewers), of pairwise co-time and of the daily `rooms_created` counter returns the stored totals **plus** the contribution of rooms whose `stats_rolled_up_at` is still null: live rooms, and ended rooms the roll-up hasn't reached yet.

- The live part is computed at read time by the same SQL as the roll-up (`src/server/stats.ts`, on the interval rules of `src/server/intervals.ts`), so a room's numbers don't change when it rolls up. Open intervals count up to their last-seen checkpoint (ADR 12). Peak viewers combine with `greatest`, not a sum.
- The roll-up at room end stays the only write. It claims the room with `stats_rolled_up_at` in the same transaction as its upsert, so a room is in the stored totals or in the live part, never both. `rooms_ended` still moves only at the roll-up.
- Only un-rolled-up rooms are scanned. There are few, and live rooms are capped, so nothing is cached.
- Per-user stats and co-time are also stored over public rooms only, and profiles and search show those to non-admins (ADR 16 addendum).

## Addendum: resilient purge (2026-10-02)
- The daily purge logs and skips a room whose roll-up fails, so one bad room no longer stops the deletes. That room stays un-rolled-up (and so is never deleted) and is retried on the next run.
- The roll-up upserts take their row locks in a stable order (`user_id`; `user_a, user_b`), so concurrent roll-ups (the boot purge alongside the hub) cannot deadlock. A partial index (`rooms_unrolled_idx`) covers ended rooms awaiting roll-up.
- The same daily job deletes Better Auth sessions past `expires_at` and logs the count. Sessions are not room-level data; this is housekeeping, not retention.

## Addendum: quality samples, 90 days (2026-10-11)
Video quality samples (`quality_samples`, ADR 2 addendum on telemetry) are kept for **90 days**, longer than the 30 days of room data, so they have a purge of their own and are not room-level data in this ADR's sense.
- They reference the room **by id only, with no foreign key**, like the audit log, so the 30-day room purge can't take them and a room's samples outlive its recap. They store the room's kind themselves (it decides how a share is tuned), and both people of each pair by their real user ids (the reporter and the peer, streamer to viewer). Only admins read them; the db already records who was in which room, so this exposes no more than that.
- The daily maintenance pass (`runMaintenance`) deletes samples older than 90 days (`purgeExpiredQualitySamples`) in a step of its own: a failure there doesn't skip the room or session purges, nor theirs this one.
- Purged samples can survive for up to 14 more days in the nightly backups (ADR 9 addendum).

## Addendum: the room timeline, 90 days (2026-10-13)
The **room timeline** (CONTEXT.md) is the admin-only record of what happened in a room, kept to diagnose problems. Its stored part is one table, `room_timeline_events`: the room id, the time (server clock, ADR 12), a `kind`, the actor's and target's real user ids, and a bounded `details` jsonb. Like quality samples and the audit log it has **no foreign keys**, so the 30-day room purge can't take it, and it is kept **90 days** by a purge step of its own in the daily pass (`purgeExpiredTimelineEvents`), independent of the others: a failure in one doesn't skip the rest. Purged rows can survive up to 14 more days in the nightly backups (ADR 9 addendum). The writes behind it are in the ADR 4 addendum on the room timeline.
- **What the hub records** (`TIMELINE_EVENT_KINDS`, src/lib/room-timeline.ts; reported from src/server/room-hub.ts): `join`, `leave` (with its reason: left, grace expired, taken over, or their grace ended by joining elsewhere); `disconnect` of a socket in a room, `grace_start`, `grace_resume` and `grace_expire` (ADR 12; a restart's restored people start a grace too); `takeover` (ADR 21: another socket of the same user in the room, or a join elsewhere); `host_change` (ADR 14, the new host and the old); `kick`, `stop_share`, `role_change`, `rename` (ADR 15, the actor and target) and `ban` (an admin's site ban removing someone; the admin is in the audit log); `knock_request`, `knock_approve`, `knock_deny` and `knock_cancel` (withdrawn, socket gone, expired or the link rotated; ADR 16); `room_end` (admin or the empty-room timer, ADR 14); `share_start` and `share_stop` (also when a sharer leaves or is removed, just before their `leave`, `kick` or `ban`); `cam_on`, `cam_off`, `mic_on` and `mic_off`. Each is recorded as the hub makes the change, never for a refused request. Someone who is in no room has nothing recorded: every row belongs to a room.
- **Refusals are summarised**, not logged one by one: the `rate_limited` and `bad_request` answers a person gets in a room are counted by message type and reason (`"chat.send:rate_limited": 3`) and written as **one `refusals` row per person, room and minute**, once the minute is over. Frames dropped over the connection budget count under `unknown`, as does any message type that isn't a real one. Slow-client drops (ADR 4 addendum on a client that stops reading) and flood closes (ADR 4 addendum on the hub's queue) are rows of their own, `slow_client` and `flood_close`. A refusal the server sent before the person was in a room has no room to go on, and is not recorded.
- **Never chat content** (ADR 4). Callers pass kinds, ids and small details only (a rename carries the old and new room name, which anyone in the room can see); refusals carry counts, never the refused text. `details` is capped at 1 KB as JSON: a larger one is stored as `{ "truncated": true }`.
- **Reading** (`getRoomTimeline`, src/server/admin-timeline.ts, behind `getRoomTimelineFn`): admins only, checked in the server half like the other admin reads. It merges, at read time and by room id alone, the stored events and the quality samples' step changes (`trigger = rung`, 90 days) with the room's presence, stream and host intervals, which are room data and so **only reach back 30 days** (an interval counts if it overlaps them). The result is sorted, oldest first, with the people named, and is **bounded** at 5,000 entries: past that it returns the **latest** 5,000 (each source is read newest first, since a diagnosis wants the recent end) and says `truncated`, meaning older entries were left out.
