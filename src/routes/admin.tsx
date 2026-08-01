import { Outlet, createFileRoute, notFound, useRouterState } from '@tanstack/react-router'
import { AdminPage } from '../features/admin/AdminPage'
import { DeletionReviewPanel } from '../features/admin/DeletionReviewPanel'
import { RoomTerminationPanel } from '../features/admin/RoomTerminationPanel'
import { SanctionPanel } from '../features/admin/SanctionPanel'
import { getAdminLiveRooms } from '../features/admin/admin-room-actions'
import { getAdminReportQueue } from '../features/admin/admin-report-queries'
import { getAdminSanctions } from '../features/admin/admin-sanction-queries'
import { getRouteSession } from '../server/auth/session-fn'
import { getPendingDeletionRequests } from '../server/profile/deletion-service'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const session = await getRouteSession()
    if (!session?.isPlatformAdmin) throw notFound()
    const [reports, deletionRequests, liveRooms, sanctions] = await Promise.all([
      getAdminReportQueue(),
      getPendingDeletionRequests(),
      getAdminLiveRooms(),
      getAdminSanctions(),
    ])
    return { reports, deletionRequests, liveRooms, sanctions, session }
  },
  head: () => ({
    meta: [
      { title: 'Platform Admin | BhayanakCast' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
      { name: 'description', content: 'Private Platform Admin safety workspace.' },
    ],
  }),
  component: AdminRoute,
})

function AdminRoute() {
  const { reports, deletionRequests, liveRooms, sanctions } = Route.useLoaderData()
  const isQueue = useRouterState({
    select: (state) => state.location.pathname === '/admin',
  })
  return isQueue ? (
    <AdminPage reports={reports}>
      <DeletionReviewPanel requests={deletionRequests} />
      <SanctionPanel dashboard={sanctions} />
      <RoomTerminationPanel rooms={liveRooms} />
    </AdminPage>
  ) : (
    <Outlet />
  )
}
