# 21. One room connection per user (takeover)

Date: 2026-09-27 · Status: accepted

## Decision
A user holds at most one room connection. Joining any room from a new tab or device performs a **takeover**: the previous connection is told "joined from elsewhere" and leaves its room, including its peer connections. A room with 10 people refuses joins with a "room full" state, which the client retries automatically when a spot frees. There is no waitlist.

## Consequences
- Presence intervals, co-time and the 10-person cap stay truthful, and nobody double-uploads media.
- Multi-tab use is limited on purpose; a second tab can browse but not be in a room.

## Addendum: a refused join leaves you where you are (2026-10-03)
A `room.join` that is refused (kicked from that room, it is full, it isn't live, or it is private and they weren't let in) no longer takes the user out of the room they are in: the room hasn't changed and nobody sees them leave. They leave their current room only once the join can't be refused, just before the takeover (`room.join` in `src/server/room-hub.ts`). A join that is answered with `ended` (an admin ended the room while they were away) counts as refused too.
