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

## Addendum: trigram index for username search (2026-10-02)
User search matches `coalesce(discord_username, name) ilike '%q%'`, which no btree serves. Migration 0007 creates the `pg_trgm` extension (bundled with the Postgres image's contrib; the app's database user is the image's superuser, so `create extension` is allowed) and a GIN `gin_trgm_ops` index on that exact expression, `user_username_trgm_idx`; the planner uses an index only for the same expression, so the query and the index must change together. It replaces `user_discord_username_idx`, a btree on `discord_username` that no query used. Tests load PGlite's `pg_trgm` in `createTestDb`, so the migration runs there unchanged.

## Addendum: statements have a timeout (2026-10-02)
The postgres-js client had no statement timeout, and the realtime hub runs every operation (heartbeats and grace timers included) on one serial queue (ADR 4), so one hung query froze every room until clients timed out and reconnected all at once. `createDb` now sets `statement_timeout` to `STATEMENT_TIMEOUT_MS` (10 seconds) as a connection parameter, which postgres-js sends in the startup message of each pooled connection; the app's statements finish in milliseconds, so it only cuts off a stuck one. A caller can override it through the `connection` option.
- A timed-out statement rejects with Postgres error 57014 (wrapped by Drizzle, with the Postgres error as `cause`). The hub's queue already catches, logs and answers a failed message with `internal` before moving on (`#enqueue`), so the queue goes on after at most the timeout.
- Only the app's pool has it: the migration runner (`src/db/migrate.ts`) has its own connection and is unaffected, as a migration may legitimately run long.
- PGlite, which the tests use, does not enforce `statement_timeout`: a `pg_sleep` runs to the end. The timeout itself is tested against a real Postgres in a container (`src/db/client.docker.test.ts`, `pnpm test:migrate`), and the hub's handling by making a store call stall and then fail with the timeout's error (`src/server/realtime-slow.test.ts`).
