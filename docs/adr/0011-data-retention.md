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

## Addendum: stat definitions (2026-09-27)
- **Hours watched** = time present in a room *minus* that user's own stream intervals in it. Watched and streamed never overlap.
- **Hours streamed** = the sum of the user's stream intervals.
- **Rooms hosted**: every user who held the host role at any point in a room gets +1 for that room (at most once per room). This requires a host-interval log (`host_intervals`: roomId, userId, startedAt, endedAt), written by the realtime server on room creation and on each host transfer (ADR 14).
