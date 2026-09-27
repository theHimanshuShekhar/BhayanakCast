# 21. One room connection per user (takeover)

Date: 2026-09-27 · Status: accepted

## Decision
A user holds at most one room connection. Joining any room from a new tab or device performs a **takeover**: the previous connection is told "joined from elsewhere" and leaves its room, including its peer connections. A room with 10 people refuses joins with a "room full" state, which the client retries automatically when a spot frees. There is no waitlist.

## Consequences
- Presence intervals, co-time and the 10-person cap stay truthful, and nobody double-uploads media.
- Multi-tab use is limited on purpose; a second tab can browse but not be in a room.
