# 8. Postgres with Drizzle ORM

Date: 2026-09-27 · Status: accepted

## Decision
Postgres is the single datastore, accessed through Drizzle ORM with drizzle-kit migrations. It holds auth tables (ADR 7), users/profiles, rooms, the room-session event log (joins/leaves, stream start/stop), derived co-time, and favorites. Chat is not stored.

## Consequences
- Recaps, co-time and admin aggregates are SQL queries over the event log, materialised when a room ends where needed.
- One Postgres container runs alongside the app.
