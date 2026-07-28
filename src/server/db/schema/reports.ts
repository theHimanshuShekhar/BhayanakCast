import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { room } from './rooms'

/** ADR 0008: one structured report per submission, private to the internal
    review queue. No reporter-facing status column — V1 has no status to show. */
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey(),
    reporterAccountId: text('reporter_account_id')
      .notNull()
      .references(() => user.id),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    roomId: uuid('room_id').references(() => room.id),
    reason: text('reason').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('report_queue_idx').on(table.createdAt),
    check(
      'report_target_type_check',
      sql`${table.targetType} in ('account', 'room', 'stream', 'message')`,
    ),
    check(
      'report_reason_check',
      sql`${table.reason} in ('harassment', 'sexual', 'violence', 'privacy', 'spam', 'copyright', 'other')`,
    ),
    check(
      'report_details_check',
      sql`${table.reason} <> 'other' or (${table.details} is not null and char_length(${table.details}) > 0)`,
    ),
    check(
      'report_details_length_check',
      sql`${table.details} is null or char_length(${table.details}) <= 2000`,
    ),
  ],
)
