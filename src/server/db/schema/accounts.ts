import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

export const accountState = pgTable('account_state', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  deletionRequestedAt: timestamp('deletion_requested_at'),
})

export const anonymizedSubject = pgTable(
  'anonymized_subject',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enforcementKey: text('enforcement_key'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('anonymized_subject_enforcement_key_idx')
      .on(table.enforcementKey)
      .where(sql`${table.enforcementKey} is not null`),
  ],
)

export const platformSanction = pgTable(
  'platform_sanction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: text('account_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    subjectId: uuid('subject_id').references(() => anonymizedSubject.id),
    type: text('type').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    expiresAt: timestamp('expires_at'),
    liftedAt: timestamp('lifted_at'),
    originSanctionId: uuid('origin_sanction_id'),
  },
  (table) => [
    uniqueIndex('platform_sanction_origin_account_idx')
      .on(table.accountId, table.originSanctionId)
      .where(sql`${table.originSanctionId} is not null`),
    index('platform_sanction_subject_id_idx').on(table.subjectId),
    foreignKey({
      columns: [table.originSanctionId],
      foreignColumns: [table.id],
      name: 'platform_sanction_origin_sanction_id_fk',
    }),
    check(
      'platform_sanction_subject_check',
      sql`num_nonnulls(${table.accountId}, ${table.subjectId}) = 1`,
    ),
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
