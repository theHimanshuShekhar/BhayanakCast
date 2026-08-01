import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
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

export type ReportStatus = 'pending' | 'resolved' | 'dismissed'
export type ReportDisposition = Exclude<ReportStatus, 'pending'>

export interface AdminActor {
  readonly accountId: string
  readonly isPlatformAdmin: boolean
}

export interface ReportQueueItem {
  readonly id: string
  readonly targetType: ReportInput['targetType']
  readonly reason: ReportInput['reason']
  readonly status: ReportStatus
  readonly createdAt: Date
  readonly resolvedAt: Date | null
  readonly retainUntil: Date | null
  readonly evidenceAvailable: boolean
}

export interface ReportAccountReference {
  readonly id: string | null
  readonly displayName: string
}

export type ReportTargetReview =
  | { readonly type: 'account'; readonly account: ReportAccountReference }
  | {
      readonly type: 'room'
      readonly room: { readonly id: string; readonly name: string; readonly visibility: 'public' | 'private'; readonly endedAt: Date | null }
    }
  | {
      readonly type: 'stream'
      readonly stream: { readonly id: string; readonly startedAt: Date; readonly endedAt: Date | null; readonly account: ReportAccountReference }
    }
  | {
      readonly type: 'message'
      readonly message: { readonly id: string; readonly body: string; readonly createdAt: Date; readonly account: ReportAccountReference }
    }
  | { readonly type: 'unavailable'; readonly originalType: ReportInput['targetType'] }

export interface ReportDetail extends ReportQueueItem {
  readonly details: string | null
  readonly reporter: ReportAccountReference
  readonly room: { readonly id: string; readonly name: string; readonly visibility: 'public' | 'private' } | null
  readonly target: ReportTargetReview
  readonly resolvedBy: ReportAccountReference | null
  readonly evidenceDataUrl: string | null
}

export type ResolveReportResult =
  | { readonly status: 'updated'; readonly report: ReportDetail }
  | { readonly status: 'already-reviewed'; readonly report: ReportDetail }
  | { readonly status: 'not-found' }

export class PlatformAdminAuthorizationError extends Error {
  constructor() {
    super('Platform Admin authorization required')
    this.name = 'PlatformAdminAuthorizationError'
  }
}

interface ReportServiceOptions {
  readonly now?: () => Date
  readonly readPreview?: (previewKey: string) => Promise<Buffer | null>
  readonly operationalLog?: (entry: Readonly<Record<string, unknown>>) => void
}

interface ValidatedTarget {
  readonly previewKey: string | null
}

export class ReportService {
  private readonly now: () => Date
  private readonly readPreview: NonNullable<ReportServiceOptions['readPreview']>
  private readonly operationalLog: NonNullable<ReportServiceOptions['operationalLog']>

  constructor(private readonly pool: Pool, options: ReportServiceOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.readPreview = options.readPreview ?? (async () => null)
    this.operationalLog = options.operationalLog ?? writeOperationalLog
  }

  async submit(reporterAccountId: string, input: ReportInput): Promise<SubmitReportResult> {
    const details = normalizeReportDetails(input.reason, input.details)
    if (!details.ok) return { status: 'details-required' }
    const target = await this.validateTarget(reporterAccountId, input)
    if (!target) return { status: 'invalid-target' }

    let evidence: Buffer | null = null
    if (input.targetType === 'stream' && target.previewKey) {
      try {
        evidence = await this.readPreview(target.previewKey)
      } catch {
        evidence = null
      }
    }
    const id = randomUUID()
    const createdAt = this.now()
    await this.pool.query(
      `INSERT INTO report
         (id, reporter_account_id, target_type, target_id, room_id, reason, details,
          evidence_content, evidence_content_type, evidence_captured_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               CASE WHEN $8::bytea IS NULL THEN NULL ELSE 'image/webp' END,
               CASE WHEN $8::bytea IS NULL THEN NULL ELSE $9::timestamp END, $9::timestamp)`,
      [
        id,
        reporterAccountId,
        input.targetType,
        input.targetId,
        input.roomId,
        input.reason,
        details.details,
        evidence,
        createdAt,
      ],
    )
    this.safeOperationalLog({
      level: 'info',
      event: 'report.submitted',
      report_id: id,
      reporter_account_id: reporterAccountId,
      target_type: input.targetType,
      evidence_captured: evidence !== null,
    })
    return { status: 'received' }
  }

  async list(actor: AdminActor): Promise<ReportQueueItem[]> {
    authorize(actor)
    const result = await this.pool.query<QueueRow>(
      `SELECT id, target_type AS "targetType", reason, status, created_at AS "createdAt",
              resolved_at AS "resolvedAt", retain_until AS "retainUntil",
              evidence_content IS NOT NULL AS "evidenceAvailable"
         FROM report
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id`,
    )
    return result.rows
  }

  async detail(actor: AdminActor, reportId: string): Promise<ReportDetail | null> {
    authorize(actor)
    return this.readDetail(this.pool, reportId)
  }

  async resolve(
    actor: AdminActor,
    reportId: string,
    disposition: ReportDisposition,
  ): Promise<ResolveReportResult> {
    authorize(actor)
    if (disposition !== 'resolved' && disposition !== 'dismissed') {
      throw new TypeError('Invalid report disposition')
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query<{ status: ReportStatus; targetType: ReportInput['targetType']; evidenceAvailable: boolean }>(
        `SELECT status, target_type AS "targetType",
                evidence_content IS NOT NULL AS "evidenceAvailable"
           FROM report WHERE id = $1 FOR UPDATE`,
        [reportId],
      )
      const current = locked.rows[0]
      if (!current) {
        await client.query('ROLLBACK')
        return { status: 'not-found' }
      }
      if (current.status !== 'pending') {
        const report = await this.readDetail(client, reportId)
        await client.query('COMMIT')
        if (!report) return { status: 'not-found' }
        return { status: 'already-reviewed', report }
      }
      const resolvedAt = this.now()
      await client.query(
        `UPDATE report
            SET status = $2,
                resolved_by_account_id = $3,
                resolved_at = $4::timestamp,
                retain_until = $4::timestamp + interval '1 year'
          WHERE id = $1`,
        [reportId, disposition, actor.accountId, resolvedAt],
      )
      await client.query(
        `INSERT INTO report_audit (id, report_id, admin_account_id, action, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), reportId, actor.accountId, disposition, resolvedAt],
      )
      const report = await this.readDetail(client, reportId)
      await client.query('COMMIT')
      if (!report) return { status: 'not-found' }
      this.safeOperationalLog({
        level: 'info',
        event: `admin.report.${disposition}`,
        report_id: reportId,
        admin_account_id: actor.accountId,
        target_type: current.targetType,
        evidence_available: current.evidenceAvailable,
        retain_until: report.retainUntil?.toISOString() ?? null,
      })
      return { status: 'updated', report }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async validateTarget(
    reporterAccountId: string,
    input: ReportInput,
  ): Promise<ValidatedTarget | null> {
    if (!input.roomId || !input.targetId) return null
    const result = await this.pool.query<ValidatedTarget>(
      `SELECT CASE WHEN $2 = 'stream' THEN stream.preview_key ELSE NULL END AS "previewKey"
         FROM room_membership reporter_membership
         LEFT JOIN stream
           ON $2 = 'stream' AND stream.id::text = $3 AND stream.room_id = reporter_membership.room_id
         LEFT JOIN message
           ON $2 = 'message' AND message.id::text = $3 AND message.room_id = reporter_membership.room_id
        WHERE reporter_membership.account_id = $1
          AND reporter_membership.room_id = $4
          AND reporter_membership.left_at IS NULL
          AND (
            ($2 = 'room' AND reporter_membership.room_id::text = $3) OR
            ($2 = 'account' AND EXISTS (
              SELECT 1 FROM room_membership target_membership
               WHERE target_membership.room_id = reporter_membership.room_id
                 AND target_membership.account_id = $3
            )) OR
            ($2 = 'stream' AND stream.id IS NOT NULL) OR
            ($2 = 'message' AND message.id IS NOT NULL)
          )
        LIMIT 1`,
      [reporterAccountId, input.targetType, input.targetId, input.roomId],
    )
    return result.rows[0] ?? null
  }

  private async readDetail(client: Pool | PoolClient, reportId: string): Promise<ReportDetail | null> {
    const result = await client.query<DetailRow>(
      `SELECT report.id, report.target_type AS "targetType", report.target_id AS "targetId",
              report.reason, report.details, report.status, report.created_at AS "createdAt",
              report.resolved_at AS "resolvedAt", report.retain_until AS "retainUntil",
              report.evidence_content AS "evidenceContent",
              reporter.id AS "reporterId", reporter.name AS "reporterName",
              resolver.id AS "resolverId", resolver.name AS "resolverName",
              room.id AS "roomId", room.name AS "roomName", room.visibility AS "roomVisibility"
         FROM report
         LEFT JOIN "user" reporter ON reporter.id = report.reporter_account_id
         LEFT JOIN "user" resolver ON resolver.id = report.resolved_by_account_id
         LEFT JOIN room ON room.id = report.room_id
        WHERE report.id = $1`,
      [reportId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      targetType: row.targetType,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      retainUntil: row.retainUntil,
      evidenceAvailable: row.evidenceContent !== null,
      evidenceDataUrl: row.evidenceContent
        ? `data:image/webp;base64,${row.evidenceContent.toString('base64')}`
        : null,
      reporter: accountReference(row.reporterId, row.reporterName, 'Deleted reporter'),
      resolvedBy: row.resolverId
        ? accountReference(row.resolverId, row.resolverName, 'Former Platform Admin')
        : null,
      room: row.roomId && row.roomName && row.roomVisibility
        ? { id: row.roomId, name: row.roomName, visibility: row.roomVisibility }
        : null,
      target: await this.readTarget(client, row.targetType, row.targetId),
    }
  }

  private async readTarget(
    client: Pool | PoolClient,
    type: ReportInput['targetType'],
    targetId: string,
  ): Promise<ReportTargetReview> {
    if (type === 'account') {
      const result = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM "user" WHERE id = $1',
        [targetId],
      )
      const row = result.rows[0]
      return row
        ? { type, account: accountReference(row.id, row.name, 'Deleted Account') }
        : { type: 'unavailable', originalType: type }
    }
    if (type === 'room') {
      const result = await client.query<{ id: string; name: string; visibility: 'public' | 'private'; endedAt: Date | null }>(
        `SELECT id, name, visibility, ended_at AS "endedAt" FROM room WHERE id::text = $1`,
        [targetId],
      )
      const row = result.rows[0]
      return row ? { type, room: row } : { type: 'unavailable', originalType: type }
    }
    if (type === 'stream') {
      const result = await client.query<{ id: string; startedAt: Date; endedAt: Date | null; accountId: string | null; accountName: string | null }>(
        `SELECT stream.id, stream.started_at AS "startedAt", stream.ended_at AS "endedAt",
                account.id AS "accountId", account.name AS "accountName"
           FROM stream
           JOIN room_membership membership ON membership.id = stream.membership_id
           LEFT JOIN "user" account ON account.id = membership.account_id
          WHERE stream.id::text = $1`,
        [targetId],
      )
      const row = result.rows[0]
      return row
        ? { type, stream: { id: row.id, startedAt: row.startedAt, endedAt: row.endedAt, account: accountReference(row.accountId, row.accountName, 'Deleted Account') } }
        : { type: 'unavailable', originalType: type }
    }
    const result = await client.query<{ id: string; body: string; createdAt: Date; accountId: string | null; accountName: string | null }>(
      `SELECT message.id, message.body, message.created_at AS "createdAt",
              account.id AS "accountId", account.name AS "accountName"
         FROM message
         JOIN room_membership membership ON membership.id = message.membership_id
         LEFT JOIN "user" account ON account.id = membership.account_id
        WHERE message.id::text = $1`,
      [targetId],
    )
    const row = result.rows[0]
    return row
      ? { type, message: { id: row.id, body: row.body, createdAt: row.createdAt, account: accountReference(row.accountId, row.accountName, 'Deleted Account') } }
      : { type: 'unavailable', originalType: type }
  }

  private safeOperationalLog(entry: Readonly<Record<string, unknown>>) {
    try {
      this.operationalLog(entry)
    } catch {
      // Audit rows are authoritative; logging failure never blocks moderation.
    }
  }
}

interface QueueRow extends ReportQueueItem {}
interface DetailRow extends Omit<QueueRow, 'evidenceAvailable'> {
  readonly targetId: string
  readonly details: string | null
  readonly evidenceContent: Buffer | null
  readonly reporterId: string | null
  readonly reporterName: string | null
  readonly resolverId: string | null
  readonly resolverName: string | null
  readonly roomId: string | null
  readonly roomName: string | null
  readonly roomVisibility: 'public' | 'private' | null
}

function authorize(actor: AdminActor) {
  if (!actor.isPlatformAdmin) throw new PlatformAdminAuthorizationError()
}

function accountReference(id: string | null, name: string | null, fallback: string): ReportAccountReference {
  return { id, displayName: name ?? fallback }
}

function writeOperationalLog(entry: Readonly<Record<string, unknown>>) {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }))
}

let productionService: ReportService | undefined

export function bindReportRuntime(configuration: { readonly pool?: Pool; readonly readPreview?: (previewKey: string) => Promise<Buffer | null> }) {
  productionService = configuration.pool
    ? new ReportService(configuration.pool, { readPreview: configuration.readPreview })
    : undefined
}

export function getReportService(): ReportService {
  if (!productionService) throw new Error('Report runtime is not configured')
  return productionService
}

export async function submitReport(
  reporterAccountId: string,
  input: ReportInput,
): Promise<SubmitReportResult> {
  if (!normalizeReportDetails(input.reason, input.details).ok) {
    return { status: 'details-required' }
  }
  return getReportService().submit(reporterAccountId, input)
}
