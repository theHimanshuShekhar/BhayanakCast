import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  date,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 })
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

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
      .references(() => user.id, { onDelete: 'restrict' }),
    currentHostUserId: text('current_host_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    emptySince: ts('empty_since'),
    endedAt: ts('ended_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
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
      'rooms_empty_since_chk',
      sql`${table.state} <> 'empty_grace' or ${table.emptySince} is not null`,
    ),
    check(
      'rooms_ended_at_chk',
      sql`${table.state} <> 'ended' or ${table.endedAt} is not null`,
    ),
    check(
      'rooms_private_password_chk',
      sql`${table.visibility} <> 'private' or ${table.passwordHash} is not null`,
    ),
  ],
)

export const roomMemberships = pgTable(
  'room_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
    reconnectGraceEndsAt: ts('reconnect_grace_ends_at'),
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

export const streamSessions = pgTable(
  'stream_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    stopReason: streamStopReason('stop_reason'),
    hasVideo: boolean('has_video').notNull(),
    hasAudio: boolean('has_audio').notNull(),
    displaySurface: text('display_surface'),
    label: text('label'),
    thumbnailUpdatedAt: ts('thumbnail_updated_at'),
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

export const roomBans = pgTable(
  'room_bans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    bannedUserId: text('banned_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    bannedByUserId: text('banned_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    clearedAt: ts('cleared_at'),
    clearedByUserId: text('cleared_by_user_id').references(() => user.id, {
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

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('chat_messages_room_created_idx').on(table.roomId, table.createdAt),
    check(
      'chat_messages_body_len_chk',
      sql`char_length(${table.body}) between 1 and 2000`,
    ),
  ],
)

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    targetType: reportTargetType('target_type').notNull(),
    targetId: text('target_id').notNull(),
    roomId: uuid('room_id').references(() => rooms.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    details: text('details'),
    thumbnailSnapshot: bytea('thumbnail_snapshot'),
    thumbnailContentType: text('thumbnail_content_type'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
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

export const platformSanctions = pgTable(
  'platform_sanctions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    type: platformSanctionType('type').notNull(),
    reason: text('reason').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    startsAt: ts('starts_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    liftedAt: ts('lifted_at'),
    liftedByUserId: text('lifted_by_user_id').references(() => user.id, {
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

export const userDailyFacts = pgTable(
  'user_daily_facts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    streamedSeconds: integer('streamed_seconds').notNull().default(0),
    watchedSeconds: integer('watched_seconds').notNull().default(0),
    roomsHosted: integer('rooms_hosted').notNull().default(0),
    roomsJoined: integer('rooms_joined').notNull().default(0),
    peakViewers: integer('peak_viewers').notNull().default(0),
    reportsCreated: integer('reports_created').notNull().default(0),
    reportsReceived: integer('reports_received').notNull().default(0),
    computedAt: ts('computed_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_daily_facts_user_day_idx').on(table.userId, table.day),
    index('user_daily_facts_day_idx').on(table.day),
    check(
      'user_daily_facts_nonnegative_chk',
      sql`${table.streamedSeconds} >= 0 and ${table.watchedSeconds} >= 0 and ${table.roomsHosted} >= 0 and ${table.roomsJoined} >= 0 and ${table.peakViewers} >= 0 and ${table.reportsCreated} >= 0 and ${table.reportsReceived} >= 0`,
    ),
  ],
)

export const userPairDailyFacts = pgTable(
  'user_pair_daily_facts',
  {
    userAId: text('user_a_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    secondsTogether: integer('seconds_together').notNull().default(0),
    roomsTogether: integer('rooms_together').notNull().default(0),
    computedAt: ts('computed_at').notNull().defaultNow(),
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
