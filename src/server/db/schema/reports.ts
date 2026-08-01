import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { room } from './rooms'

/** ADR 0008: one structured private safety signal per submission. Review
    lifecycle exists only inside the Platform Admin boundary. */
const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
})

export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey(),
    reporterAccountId: text('reporter_account_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reporterSubjectRef: uuid('reporter_subject_ref'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    roomId: uuid('room_id').references(() => room.id),
    reason: text('reason').notNull(),
    details: text('details'),
    subjectRef: uuid('subject_ref'),
    status: text('status').notNull().default('pending'),
    resolvedByAccountId: text('resolved_by_account_id').references(() => user.id),
    resolvedAt: timestamp('resolved_at'),
    retainUntil: timestamp('retain_until'),
    evidenceContent: bytea('evidence_content'),
    evidenceContentType: text('evidence_content_type'),
    evidenceCapturedAt: timestamp('evidence_captured_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('report_queue_idx').on(table.createdAt),
    index('report_status_queue_idx').on(table.status, table.createdAt),
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
    check(
      'report_status_check',
      sql`${table.status} in ('pending', 'resolved', 'dismissed')`,
    ),
    check(
      'report_resolution_check',
      sql`(${table.status} = 'pending' and ${table.resolvedByAccountId} is null and ${table.resolvedAt} is null and ${table.retainUntil} is null) or (${table.status} in ('resolved', 'dismissed') and ${table.resolvedByAccountId} is not null and ${table.resolvedAt} is not null and ${table.retainUntil} = ${table.resolvedAt} + interval '1 year')`,
    ),
    check(
      'report_evidence_check',
      sql`(${table.evidenceContent} is null and ${table.evidenceContentType} is null and ${table.evidenceCapturedAt} is null) or (${table.targetType} = 'stream' and ${table.evidenceContent} is not null and ${table.evidenceContentType} = 'image/webp' and ${table.evidenceCapturedAt} is not null)`,
    ),
  ],
)

export const reportAudit = pgTable(
  'report_audit',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    adminAccountId: text('admin_account_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('report_audit_report_idx').on(table.reportId, table.createdAt),
    check('report_audit_action_check', sql`${table.action} in ('resolved', 'dismissed')`),
  ],
)
