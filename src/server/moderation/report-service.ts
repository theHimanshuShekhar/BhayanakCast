import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

/** ADR 0008's fixed top-level reasons. `other` is the only one that requires
    details, and the form enforces the same rule the table checks. */
export const REPORT_REASONS = [
  'harassment',
  'sexual',
  'violence',
  'privacy',
  'spam',
  'copyright',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportTargetType = 'account' | 'room' | 'stream' | 'message'

export interface ReportInput {
  readonly targetType: ReportTargetType
  readonly targetId: string
  readonly roomId: string | null
  readonly reason: ReportReason
  readonly details: string | null
}

export type SubmitReportResult =
  | { readonly status: 'received' }
  | { readonly status: 'details-required' }

const DETAILS_LIMIT = 2_000

let pool: Pool | undefined

export function bindReportRuntime(configuration: { readonly pool?: Pool }) {
  pool = configuration.pool
}

export async function submitReport(
  reporterAccountId: string,
  input: ReportInput,
  now: Date = new Date(),
): Promise<SubmitReportResult> {
  const details = input.details?.normalize('NFKC').trim() || null
  if (input.reason === 'other' && !details) return { status: 'details-required' }
  if (details && details.length > DETAILS_LIMIT) return { status: 'details-required' }
  if (!pool) throw new Error('Report runtime is not configured')
  await pool.query(
    `INSERT INTO report
       (id, reporter_account_id, target_type, target_id, room_id, reason, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      reporterAccountId,
      input.targetType,
      input.targetId,
      input.roomId,
      input.reason,
      details,
      now,
    ],
  )
  return { status: 'received' }
}
