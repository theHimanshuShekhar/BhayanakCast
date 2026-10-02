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
