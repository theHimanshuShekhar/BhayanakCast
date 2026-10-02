# 8. Postgres with Drizzle ORM

Date: 2026-09-27 · Status: accepted

## Decision
Postgres is the single datastore, accessed through Drizzle ORM with drizzle-kit migrations. It holds auth tables (ADR 7), users/profiles, rooms, the room-session event log (joins/leaves, stream start/stop), derived co-time, and favorites. Chat is not stored.

## Consequences
- Recaps, co-time and admin aggregates are SQL queries over the event log, materialised when a room ends where needed.
- One Postgres container runs alongside the app.

## Addendum: the migration runner is serialised and order-checked (2026-10-02)
The app applies migrations at container start (`src/db/migrate.ts`, Drizzle's runtime migrator). Two guards now sit around it. It takes a Postgres advisory lock on a dedicated connection, so instances starting together take turns and the second finds nothing to apply. Under the lock it also reads the journal and `drizzle.__drizzle_migrations`: Drizzle compares only the newest applied `created_at` with each entry's `when`, so an entry that was never applied but is not newer than that one would be skipped silently and for good. The runner refuses to start instead, naming the entry (regenerate it with a newer timestamp; typically after two branches each added a migration).

`DATABASE_URL` stays one variable, and compose pastes `POSTGRES_USER` and `POSTGRES_PASSWORD` into it unencoded. The password must be URL-safe, which `openssl rand -hex 24` gives. Env validation (and the migrate script) now refuse a URL whose parts would parse as a different host, port or path, such as a password with `/`, `#` or `?`, and say to percent-encode or use a URL-safe password. Building the connection from separate `PG*` variables would have touched compose, the app, drizzle-kit and the backup sidecar for the same result.
