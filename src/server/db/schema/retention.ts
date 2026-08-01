import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'

export const retentionRunAudit = pgTable(
  'retention_run_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ranAt: timestamp('ran_at').notNull(),
    transcriptRowsDeleted: integer('transcript_rows_deleted').notNull(),
    reportRowsDeleted: integer('report_rows_deleted').notNull(),
    enforcementKeysExpired: integer('enforcement_keys_expired').notNull(),
  },
  (table) => [
    index('retention_run_audit_ran_at_idx').on(table.ranAt),
    check(
      'retention_run_audit_counts_check',
      sql`${table.transcriptRowsDeleted} >= 0 and ${table.reportRowsDeleted} >= 0 and ${table.enforcementKeysExpired} >= 0`,
    ),
  ],
)
