import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readSessionProjection } from '../../server/auth/auth'
import {
  getReportService,
  PlatformAdminAuthorizationError,
  type AdminActor,
  type ReportDisposition,
} from '../../server/moderation/report-service'
import { recordModerationInteraction } from '../../server/moderation/moderation-observability'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const getAdminReportQueue = createServerFn({ method: 'GET' }).handler(async () => {
  const actor = await requireAdmin()
  const reports = await getReportService().list(actor)
  await recordModerationInteraction({
    name: 'admin_report_queue_viewed',
    properties: {},
  })
  return reports
})

export const getAdminReportDetail = createServerFn({ method: 'GET' })
  .validator(validateReportId)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    const report = await getReportService().detail(actor, data)
    if (report) {
      await recordModerationInteraction({
        name: 'admin_report_opened',
        properties: {
          target_type: report.targetType,
          evidence_available: report.evidenceAvailable,
        },
      })
    }
    return report
  })

export const reviewAdminReport = createServerFn({ method: 'POST' })
  .validator(validateReviewCommand)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    const result = await getReportService().resolve(actor, data.reportId, data.disposition)
    if (result.status === 'updated') {
      await recordModerationInteraction({
        name: 'admin_report_review_submitted',
        properties: {
          target_type: result.report.targetType,
          disposition: data.disposition,
          evidence_available: result.report.evidenceAvailable,
        },
      })
    }
    return result
  })

async function requireAdmin(): Promise<AdminActor> {
  const session = await readSessionProjection(
    getProductionAuth(),
    getRequest().headers,
  )
  if (!session?.isPlatformAdmin) throw new PlatformAdminAuthorizationError()
  return { accountId: session.id, isPlatformAdmin: true }
}

function validateReportId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError('Invalid report id')
  }
  return value.toLowerCase()
}

function validateReviewCommand(value: unknown): {
  readonly reportId: string
  readonly disposition: ReportDisposition
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid report review')
  }
  const source = value as Record<string, unknown>
  const keys = Object.keys(source)
  if (
    keys.length !== 2 ||
    !keys.includes('reportId') ||
    !keys.includes('disposition') ||
    (source.disposition !== 'resolved' && source.disposition !== 'dismissed')
  ) {
    throw new TypeError('Invalid report review')
  }
  return {
    reportId: validateReportId(source.reportId),
    disposition: source.disposition,
  }
}
