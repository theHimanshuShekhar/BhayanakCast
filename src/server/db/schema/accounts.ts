import { sql } from 'drizzle-orm'
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const accountState = pgTable('account_state', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  deletionRequestedAt: timestamp('deletion_requested_at'),
})

export const platformSanction = pgTable(
  'platform_sanction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    expiresAt: timestamp('expires_at'),
    liftedAt: timestamp('lifted_at'),
  },
  (table) => [
    check(
      'platform_sanction_type_check',
      sql`${table.type} in ('streaming', 'chat', 'room_creation', 'all_access')`,
    ),
    check(
      'platform_sanction_expiry_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.startsAt}`,
    ),
  ],
)
