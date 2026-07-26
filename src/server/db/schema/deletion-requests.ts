import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

export const deletionRequest = pgTable(
  'deletion_request',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  (table) => [
    check(
      'deletion_request_status_check',
      sql`${table.status} in ('pending', 'cancelled', 'rejected', 'approved')`,
    ),
    index('deletion_request_account_id_idx').on(table.accountId),
    uniqueIndex('deletion_request_pending_account_idx')
      .on(table.accountId)
      .where(sql`${table.status} = 'pending'`),
  ],
)

export const deletionRequestAudit = pgTable(
  'deletion_request_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => deletionRequest.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    check(
      'deletion_request_audit_event_check',
      sql`${table.event} in ('submitted', 'cancelled', 'rejected', 'approved')`,
    ),
    index('deletion_request_audit_request_id_idx').on(table.requestId),
    index('deletion_request_audit_account_id_idx').on(table.accountId),
  ],
)
