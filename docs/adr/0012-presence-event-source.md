# 12. Server WebSocket lifecycle is the source of truth for presence events

Date: 2026-09-27 · Status: accepted

## Decision
- **Join**: an authenticated WebSocket joins a room.
- **Leave**: an explicit leave, or the socket stays closed past a ~30s grace period. A reconnect within the grace period continues the same presence interval, so page reloads and network blips don't split it.
- **Stream start/stop**: the server records these when it relays screen-share signalling messages.
- Timestamps come from the server clock only. Clients never report durations.

## Consequences
- Hours watched, co-time and recap timelines can't be forged by clients.
- On a server restart, open intervals are closed at the last-seen time (from a periodic in-memory → DB checkpoint) rather than left dangling.

## Addendum: stream events come from the acknowledged share state (2026-09-28)
Stream start and stop are recorded when the server accepts a participant's `media.state` share flag. A share start is refused beyond 3 streamers. Recording doesn't wait for screen-share signalling to be relayed. The client only turns the share flag on once it holds a live screen track (spec #4), and turns it off when the track ends. Server clock only, as before.
