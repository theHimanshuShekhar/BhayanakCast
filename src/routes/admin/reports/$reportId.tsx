import { createFileRoute, notFound } from '@tanstack/react-router'
import { AdminReportDetailPage } from '../../../features/admin/AdminReportDetailPage'
import { getAdminReportDetail } from '../../../features/admin/admin-report-queries'
import { getRouteSession } from '../../../server/auth/session-fn'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const Route = createFileRoute('/admin/reports/$reportId')({
  loader: async ({ params }) => {
    if (!UUID.test(params.reportId)) throw notFound()
    const session = await getRouteSession()
    if (!session?.isPlatformAdmin) throw notFound()
    const report = await getAdminReportDetail({ data: params.reportId })
    if (!report) throw notFound()
    return { report, session }
  },
  head: () => ({
    meta: [
      { title: 'Report review | BhayanakCast' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
      { name: 'description', content: 'Private Platform Admin report review.' },
    ],
  }),
  component: AdminReportRoute,
})

function AdminReportRoute() {
  const { report } = Route.useLoaderData()
  return <AdminReportDetailPage initialReport={report} />
}
