import { sql } from 'drizzle-orm'
import {
  check,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { roomMembership } from './memberships'
import { stream } from './streams'

export const streamSubscription = pgTable(
  'stream_subscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    viewerMembershipId: uuid('viewer_membership_id')
      .notNull()
      .references(() => roomMembership.id),
    streamId: uuid('stream_id')
      .notNull()
      .references(() => stream.id),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [
    uniqueIndex('stream_subscription_one_active_viewer_idx')
      .on(table.viewerMembershipId)
      .where(sql`${table.endedAt} is null`),
    check(
      'stream_subscription_interval_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
)
