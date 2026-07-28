import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { normalizeReportDetails, type ReportInput, type SubmitReportResult } from './report-policy'

export {
  REPORT_REASONS,
  REPORT_DETAILS_LIMIT,
  normalizeReportDetails,
  type ReportInput,
  type ReportReason,
  type ReportTargetType,
  type SubmitReportResult,
} from './report-policy'

let pool: Pool | undefined

export function bindReportRuntime(configuration: { readonly pool?: Pool }) {
  pool = configuration.pool
}

export async function submitReport(
  reporterAccountId: string,
  input: ReportInput,
  now: Date = new Date(),
): Promise<SubmitReportResult> {
  const details = normalizeReportDetails(input.reason, input.details)
  if (!details.ok) return { status: 'details-required' }
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
      details.details,
      now,
    ],
  )
  return { status: 'received' }
}
