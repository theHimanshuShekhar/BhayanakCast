# 8. Postgres with Drizzle ORM

Date: 2026-09-27 · Status: accepted

## Decision
Postgres is the single datastore, accessed through Drizzle ORM with drizzle-kit migrations. It holds auth tables (ADR 7), users/profiles, rooms, the room-session event log (joins/leaves, stream start/stop), derived co-time, and favorites. Chat is not stored.

## Consequences
- Recaps, co-time and admin aggregates are SQL queries over the event log, materialised when a room ends where needed.
- One Postgres container runs alongside the app.

## Addendum: trigram index for username search (2026-10-02)
User search matches `coalesce(discord_username, name) ilike '%q%'`, which no btree serves. Migration 0007 creates the `pg_trgm` extension (bundled with the Postgres image's contrib; the app's database user is the image's superuser, so `create extension` is allowed) and a GIN `gin_trgm_ops` index on that exact expression, `user_username_trgm_idx`; the planner uses an index only for the same expression, so the query and the index must change together. It replaces `user_discord_username_idx`, a btree on `discord_username` that no query used. Tests load PGlite's `pg_trgm` in `createTestDb`, so the migration runs there unchanged.
