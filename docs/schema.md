# V1 Schema Handoff

Use boring `snake_case` names. Better Auth owns its own auth tables; product tables reference Better Auth user IDs.

See [`drizzle-schema.md`](./drizzle-schema.md) for exact Drizzle column types, indexes, constraints, and migration order.

## Product tables

### `rooms`

Lifecycle aggregate for live rooms and Past Streams.

Critical fields/constraints:

- `id` primary key.
- `state` enum: `live`, `empty_grace`, `ended`.
- `visibility` enum: `public`, `private`.
- `current_host_user_id` references Better Auth user ID.
- `created_by_user_id` references Better Auth user ID.
- `name`, `category`, `tags` store create-room metadata.
- `password_hash` nullable; required when `visibility = private`.
- `empty_since`, `ended_at`, `created_at`, `updated_at` timestamps.
- Index active discovery queries by `state`, `visibility`, `updated_at`/`created_at`.

### `room_memberships`

Append-only join interval history.

Critical fields/constraints:

- `id` primary key.
- `room_id` references `rooms.id`.
- `user_id` references Better Auth user ID.
- `joined_at`, `left_at` nullable.
- Index `(room_id, left_at)` for active membership lookup.
- Index `(user_id, joined_at)` for profile/history aggregation.

### `room_bans`

Host-applied room bans.

Critical fields/constraints:

- `id` primary key.
- `room_id` references `rooms.id`.
- `banned_user_id` references Better Auth user ID.
- `banned_by_user_id` references Better Auth user ID.
- `created_at`, `cleared_at` nullable.
- Enforce at most one effective ban per `(room_id, banned_user_id)` where `cleared_at is null`.

### `stream_sessions`

One row per start/stop stream session.

Critical fields/constraints:

- `id` primary key.
- `room_id` references `rooms.id`.
- `user_id` references Better Auth user ID.
- `started_at`, `ended_at` nullable.
- `has_video`, `has_audio` booleans from captured tracks.
- `display_surface` and optional app/window label.
- Index `(room_id, ended_at)` for active stream lookup.
- Index `(user_id, started_at)` for aggregation.

### `chat_messages`

Persisted room transcript messages.

Critical fields/constraints:

- `id` primary key.
- `room_id` references `rooms.id`.
- `user_id` references Better Auth user ID.
- `body`, `created_at`.
- Index `(room_id, created_at)` for transcript and chat ordering.

### `reports`

User-submitted safety reports.

Critical fields/constraints:

- `id` primary key.
- `reporter_user_id` references Better Auth user ID.
- `target_type` enum: `account`, `room`, `stream_session`, `chat_message`.
- `target_id` stores the target primary key; validate target existence in application code.
- `room_id` nullable context reference for room-scoped reports.
- `reason`, `details`, `created_at`, `resolved_at` nullable.
- `thumbnail_snapshot` nullable `bytea` for frozen blurred stream report thumbnails.
- Index by `created_at`, `resolved_at`, and `target_type,target_id`.

### `platform_sanctions`

Append-only platform-admin enforcement records.

Critical fields/constraints:

- `id` primary key.
- `user_id` references Better Auth user ID.
- `type` enum: `stream_ban`, `chat_ban`, `room_creation_ban`, `full_suspension`.
- `reason`, `created_by_user_id`, `created_at`, `starts_at`, `expires_at` nullable, `lifted_at` nullable.
- Index effective sanctions by `(user_id, type, lifted_at, expires_at)`.

### `user_daily_facts`

Nightly per-user aggregate facts.

Critical fields/constraints:

- Composite unique key `(user_id, day)`.
- Stores daily streamed seconds, watched seconds, rooms hosted, rooms joined, peak viewers, and other profile/admin metrics.
- `computed_at` timestamp for freshness.

### `user_pair_daily_facts`

Nightly co-user aggregate facts.

Critical fields/constraints:

- `user_a_id` and `user_b_id` reference Better Auth user IDs.
- Enforce canonical ordering: `user_a_id < user_b_id`.
- Composite unique key `(user_a_id, user_b_id, day)`.
- Stores `seconds_together` and `rooms_together`.
- `computed_at` timestamp for freshness.

## Live-only state

Do not persist these as product tables in v1:

- Socket.IO room membership/socket IDs.
- Stream subscriptions.
- Latest blurred preview thumbnails, except report snapshots.
- WebRTC offers, answers, and ICE candidates.
- Compatibility-gate transient results.

## Validation boundary

Zod schemas should validate create-room inputs, room join/password inputs, Socket.IO command payloads, report payloads, thumbnail metadata/size, and admin sanction commands before data reaches Drizzle writes.
