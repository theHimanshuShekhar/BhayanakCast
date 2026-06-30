# Drizzle Schema Detail

This is the implementation-facing Drizzle schema contract. It expands [`schema.md`](./schema.md) with exact PostgreSQL/Drizzle column types, indexes, constraints, and migration order.

## Global decisions

- Product row IDs use `uuid(...).defaultRandom().primaryKey()`.
- Better Auth user IDs are `text` and are referenced from the Better Auth `user.id` column exported by the generated/auth schema.
- Timestamps use `timestamp({ withTimezone: true, precision: 3 })`.
- Date facts use `date({ mode: "string" })` so aggregation days are stored as `YYYY-MM-DD` strings and do not shift by runtime timezone.
- Payload/API fields stay `camelCase`; database columns stay `snake_case`.
- PostgreSQL enums are used for stable finite domains.
- Use partial unique indexes for “one active/effective row” rules.
- Use Drizzle `check(...)` constraints for field bounds that must also be enforced by the database.

## Expected source layout

```txt
src/db/
  schema/
    auth.ts              # Better Auth generated/exported schema
    enums.ts             # product pgEnum definitions
    rooms.ts
    moderation.ts
    aggregates.ts
    index.ts             # re-exports all schemas
  migrations/            # drizzle-kit output
  client.ts
  migrate.ts             # startup migration runner
```

`auth.ts` may be generated or adapted from Better Auth's Drizzle adapter output. Product tables should import the Better Auth user table as `authUser`.

## Shared imports

```ts
import { sql } from 'drizzle-orm'
import {
  boolean,
  bytea,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user as authUser } from './auth'
```

## Enums

```ts
export const roomState = pgEnum('room_state', ['live', 'empty_grace', 'ended'])

export const roomVisibility = pgEnum('room_visibility', ['public', 'private'])

export const reportTargetType = pgEnum('report_target_type', [
  'account',
  'room',
  'stream_session',
  'chat_message',
])

export const reportResolution = pgEnum('report_resolution', [
  'resolved',
  'dismissed',
])

export const platformSanctionType = pgEnum('platform_sanction_type', [
  'stream_ban',
  'chat_ban',
  'room_creation_ban',
  'full_suspension',
])

export const streamStopReason = pgEnum('stream_stop_reason', [
  'self',
  'host',
  'disconnect',
  'socket_replaced',
  'room_ended',
])
```

## Tables

### `rooms`

```ts
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: text('name').notNull(),
    category: text('category').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    visibility: roomVisibility('visibility').notNull().default('public'),
    passwordHash: text('password_hash'),
    state: roomState('state').notNull().default('live'),

    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    currentHostUserId: text('current_host_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    emptySince: timestamp('empty_since', { withTimezone: true, precision: 3 }),
    endedAt: timestamp('ended_at', { withTimezone: true, precision: 3 }),

    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('rooms_discovery_idx').on(
      table.state,
      table.visibility,
      table.updatedAt,
    ),
    index('rooms_created_by_idx').on(table.createdByUserId, table.createdAt),
    index('rooms_current_host_idx').on(table.currentHostUserId),

    check(
      'rooms_name_len_chk',
      sql`char_length(${table.name}) between 3 and 80`,
    ),
    check(
      'rooms_category_len_chk',
      sql`char_length(${table.category}) between 1 and 80`,
    ),
    check(
      'rooms_tags_count_chk',
      sql`array_length(${table.tags}, 1) is null or array_length(${table.tags}, 1) <= 5`,
    ),
    check(
      'rooms_private_password_chk',
      sql`${table.visibility} <> 'private' or ${table.passwordHash} is not null`,
    ),
    check(
      'rooms_empty_since_chk',
      sql`${table.state} <> 'empty_grace' or ${table.emptySince} is not null`,
    ),
    check(
      'rooms_ended_at_chk',
      sql`${table.state} <> 'ended' or ${table.endedAt} is not null`,
    ),
  ],
)
```

Notes:

- `passwordHash` is never returned to clients.
- `updatedAt` must be updated by application code or a migration-added trigger; do not assume Drizzle updates it automatically.
- Per-tag length is enforced by Zod, not a database `CHECK`, because PostgreSQL checks cannot use subqueries over `unnest(tags)`.

### `room_memberships`

```ts
export const roomMemberships = pgTable(
  'room_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    joinedAt: timestamp('joined_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true, precision: 3 }),
    reconnectGraceEndsAt: timestamp('reconnect_grace_ends_at', {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    index('room_memberships_room_active_idx').on(table.roomId, table.leftAt),
    index('room_memberships_user_joined_idx').on(table.userId, table.joinedAt),
    uniqueIndex('room_memberships_one_active_user_per_room_idx')
      .on(table.roomId, table.userId)
      .where(sql`${table.leftAt} is null`),
    check(
      'room_memberships_interval_chk',
      sql`${table.leftAt} is null or ${table.leftAt} >= ${table.joinedAt}`,
    ),
  ],
)
```

### `room_bans`

```ts
export const roomBans = pgTable(
  'room_bans',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    bannedUserId: text('banned_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    bannedByUserId: text('banned_by_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    clearedAt: timestamp('cleared_at', { withTimezone: true, precision: 3 }),
    clearedByUserId: text('cleared_by_user_id').references(() => authUser.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    index('room_bans_room_idx').on(table.roomId),
    index('room_bans_banned_user_idx').on(table.bannedUserId),
    uniqueIndex('room_bans_one_effective_idx')
      .on(table.roomId, table.bannedUserId)
      .where(sql`${table.clearedAt} is null`),
    check(
      'room_bans_clear_consistency_chk',
      sql`(${table.clearedAt} is null and ${table.clearedByUserId} is null) or (${table.clearedAt} is not null and ${table.clearedByUserId} is not null)`,
    ),
  ],
)
```

### `stream_sessions`

```ts
export const streamSessions = pgTable(
  'stream_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    startedAt: timestamp('started_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true, precision: 3 }),
    stopReason: streamStopReason('stop_reason'),

    hasVideo: boolean('has_video').notNull(),
    hasAudio: boolean('has_audio').notNull(),
    displaySurface: text('display_surface'),
    label: text('label'),
    thumbnailUpdatedAt: timestamp('thumbnail_updated_at', {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    index('stream_sessions_room_active_idx').on(table.roomId, table.endedAt),
    index('stream_sessions_user_started_idx').on(table.userId, table.startedAt),
    uniqueIndex('stream_sessions_one_active_user_per_room_idx')
      .on(table.roomId, table.userId)
      .where(sql`${table.endedAt} is null`),
    check('stream_sessions_track_chk', sql`${table.hasVideo} = true`),
    check(
      'stream_sessions_interval_chk',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      'stream_sessions_stop_reason_chk',
      sql`(${table.endedAt} is null and ${table.stopReason} is null) or (${table.endedAt} is not null and ${table.stopReason} is not null)`,
    ),
  ],
)
```

Notes:

- `thumbnailUpdatedAt` records the latest in-memory thumbnail timestamp for UI state only. Thumbnail bytes are not stored here.
- `stream_sessions_one_active_user_per_room_idx` enforces one active stream per user per room.

### `chat_messages`

```ts
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chat_messages_room_created_idx').on(table.roomId, table.createdAt),
    index('chat_messages_user_created_idx').on(table.userId, table.createdAt),
    check(
      'chat_messages_body_len_chk',
      sql`char_length(${table.body}) between 1 and 2000`,
    ),
  ],
)
```

### `reports`

```ts
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),

    targetType: reportTargetType('target_type').notNull(),
    targetId: text('target_id').notNull(),
    roomId: uuid('room_id').references(() => rooms.id, {
      onDelete: 'set null',
    }),

    reason: text('reason').notNull(),
    details: text('details'),

    thumbnailSnapshot: bytea('thumbnail_snapshot'),
    thumbnailContentType: text('thumbnail_content_type'),

    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, precision: 3 }),
    resolvedByUserId: text('resolved_by_user_id').references(
      () => authUser.id,
      { onDelete: 'restrict' },
    ),
    resolution: reportResolution('resolution'),
    resolutionNote: text('resolution_note'),
  },
  (table) => [
    index('reports_created_idx').on(table.createdAt),
    index('reports_resolved_idx').on(table.resolvedAt),
    index('reports_target_idx').on(table.targetType, table.targetId),
    index('reports_room_idx').on(table.roomId),
    check(
      'reports_reason_len_chk',
      sql`char_length(${table.reason}) between 1 and 120`,
    ),
    check(
      'reports_details_len_chk',
      sql`${table.details} is null or char_length(${table.details}) <= 4000`,
    ),
    check(
      'reports_resolution_consistency_chk',
      sql`(${table.resolvedAt} is null and ${table.resolvedByUserId} is null and ${table.resolution} is null) or (${table.resolvedAt} is not null and ${table.resolvedByUserId} is not null and ${table.resolution} is not null)`,
    ),
    check(
      'reports_thumbnail_content_type_chk',
      sql`${table.thumbnailContentType} is null or ${table.thumbnailContentType} in ('image/webp', 'image/jpeg')`,
    ),
  ],
)
```

Notes:

- `targetId` is `text` because targets may be Better Auth user IDs or product UUIDs. Application code validates existence against `targetType`.
- `thumbnailSnapshot` stores the frozen blurred report snapshot only. Latest stream previews remain in memory.

### `platform_sanctions`

```ts
export const platformSanctions = pgTable(
  'platform_sanctions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    type: platformSanctionType('type').notNull(),
    reason: text('reason').notNull(),

    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),

    startsAt: timestamp('starts_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }),
    liftedAt: timestamp('lifted_at', { withTimezone: true, precision: 3 }),
    liftedByUserId: text('lifted_by_user_id').references(() => authUser.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    index('platform_sanctions_effective_idx').on(
      table.userId,
      table.type,
      table.liftedAt,
      table.expiresAt,
    ),
    index('platform_sanctions_created_idx').on(table.createdAt),
    check(
      'platform_sanctions_reason_len_chk',
      sql`char_length(${table.reason}) between 1 and 500`,
    ),
    check(
      'platform_sanctions_expiry_chk',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.startsAt}`,
    ),
    check(
      'platform_sanctions_lift_consistency_chk',
      sql`(${table.liftedAt} is null and ${table.liftedByUserId} is null) or (${table.liftedAt} is not null and ${table.liftedByUserId} is not null)`,
    ),
  ],
)
```

### `user_daily_facts`

```ts
export const userDailyFacts = pgTable(
  'user_daily_facts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),

    streamedSeconds: integer('streamed_seconds').notNull().default(0),
    watchedSeconds: integer('watched_seconds').notNull().default(0),
    roomsHosted: integer('rooms_hosted').notNull().default(0),
    roomsJoined: integer('rooms_joined').notNull().default(0),
    peakViewers: integer('peak_viewers').notNull().default(0),
    reportsCreated: integer('reports_created').notNull().default(0),
    reportsReceived: integer('reports_received').notNull().default(0),

    computedAt: timestamp('computed_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('user_daily_facts_user_day_idx').on(table.userId, table.day),
    index('user_daily_facts_day_idx').on(table.day),
    check(
      'user_daily_facts_nonnegative_chk',
      sql`
    ${table.streamedSeconds} >= 0 and
    ${table.watchedSeconds} >= 0 and
    ${table.roomsHosted} >= 0 and
    ${table.roomsJoined} >= 0 and
    ${table.peakViewers} >= 0 and
    ${table.reportsCreated} >= 0 and
    ${table.reportsReceived} >= 0
  `,
    ),
  ],
)
```

### `user_pair_daily_facts`

```ts
export const userPairDailyFacts = pgTable(
  'user_pair_daily_facts',
  {
    userAId: text('user_a_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),

    secondsTogether: integer('seconds_together').notNull().default(0),
    roomsTogether: integer('rooms_together').notNull().default(0),

    computedAt: timestamp('computed_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('user_pair_daily_facts_pair_day_idx').on(
      table.userAId,
      table.userBId,
      table.day,
    ),
    index('user_pair_daily_facts_user_a_idx').on(table.userAId, table.day),
    index('user_pair_daily_facts_user_b_idx').on(table.userBId, table.day),
    check(
      'user_pair_daily_facts_order_chk',
      sql`${table.userAId} < ${table.userBId}`,
    ),
    check(
      'user_pair_daily_facts_nonnegative_chk',
      sql`${table.secondsTogether} >= 0 and ${table.roomsTogether} >= 0`,
    ),
  ],
)
```

## Migration order

Use Drizzle Kit generated migrations, but keep the logical order stable. App startup runs migrations and must fail hard if they fail.

### Migration 0000 — auth plus room/chat core

Checked-in file: `src/db/migrations/0000_marvelous_talon.sql`

Creates:

- Better Auth tables: `user`, `session`, `account`, `verification`
- Product enums: `room_state`, `room_visibility`
- Room core tables: `rooms`, `room_memberships`, `room_bans`
- Transcript table: `chat_messages`

Rationale: this repository started with a combined foundation migration. Do not rewrite it after it has been applied; append corrective migrations instead.

### Migration 0001 — moderation

Checked-in file: `src/db/migrations/0001_chilly_morlocks.sql`

Creates:

- `platform_sanctions`
- `reports`
- `report_target_type`
- `platform_sanction_type`

Rationale: reports depend on rooms and auth users; sanctions depend on auth users.

### Migration 0002 — stream sessions

Checked-in file: `src/db/migrations/0002_youthful_barracuda.sql`

Creates:

- `stream_sessions`
- `stream_stop_reason`

Rationale: stream history depends on rooms and auth users.

### Migration 0003 — aggregate facts

Checked-in file: `src/db/migrations/0003_loud_skaar.sql`

Creates:

- `user_daily_facts`
- `user_pair_daily_facts`

Rationale: nightly aggregation depends on room, stream, membership, chat/report history.

### Migration 0004 — schema parity addendum

Checked-in file: `src/db/migrations/0004_jazzy_starbolt.sql`

Creates/adds:

- `report_resolution`
- Report resolution, thumbnail content type, and report room/resolved indexes
- Platform sanction lift ownership
- Missing lifecycle consistency checks and supporting indexes

Rationale: aligns the checked-in schema with this document without rewriting already-applied migration history.

### Future migration — optional `updated_at` trigger

If the implementation chooses database-managed `updated_at`, add a PostgreSQL trigger/function for `rooms.updated_at`. Otherwise application code must update `updated_at` on every room mutation that affects discovery or room state.

## Drizzle Kit commands

Use PostgreSQL dialect and checked-in migrations.

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
})
```

Commands:

```sh
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Startup behavior:

1. App container reads `DATABASE_URL`.
2. App container runs Drizzle migrations before accepting HTTP/Socket.IO traffic.
3. If migration fails, process exits non-zero.
4. App never serves against an unknown or partially migrated schema.

## Review checklist before implementation

- Confirm Better Auth exported user table name/shape before writing product foreign keys.
- Confirm generated SQL for partial unique indexes and checks before committing migrations.
- If a check constraint cannot be expressed safely through generated SQL, keep Zod validation and add a manual SQL migration only when the database invariant is worth it.
- Do not store live Socket.IO socket IDs, stream subscriptions, WebRTC SDP, ICE candidates, or latest preview thumbnail bytes in PostgreSQL.
