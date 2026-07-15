import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { roomMembership } from './memberships'
import { room } from './rooms'

export const stream = pgTable(
  'stream',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    membershipId: uuid('membership_id').notNull(),
    previewKey: text('preview_key'),
    previewUpdatedAt: timestamp('preview_updated_at'),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [
    foreignKey({
      columns: [table.membershipId, table.roomId],
      foreignColumns: [roomMembership.id, roomMembership.roomId],
      name: 'stream_membership_room_fk',
    }),
    uniqueIndex('stream_one_active_membership_idx')
      .on(table.membershipId)
      .where(sql`${table.endedAt} is null`),
    check(
      'stream_interval_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      'stream_preview_check',
      sql`(${table.previewKey} is null and ${table.previewUpdatedAt} is null) or (${table.previewKey} is not null and ${table.previewUpdatedAt} is not null)`,
    ),
  ],
)
