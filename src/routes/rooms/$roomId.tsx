import { createFileRoute, notFound } from '@tanstack/react-router'
import { RoomRoute } from '../../features/room/RoomRoute'
import { roomProjectionQueryOptions } from '../../features/room/room-queries'
import { RoomNotFound } from '../../features/room/RoomNotFound'
import { ROOM_ID } from '../../features/home/create-room'
import { getRouteSession } from '../../server/auth/session-fn'
import type { SessionProjection } from '../../features/auth/auth-client'
import type { RoomView } from '../../features/room/room-types'

interface RoomLoaderData {
  readonly room: RoomView
  readonly session: SessionProjection | null
}


export const Route = createFileRoute('/rooms/$roomId')({
  loader: async ({ context, params }): Promise<RoomLoaderData> => {
    if (!ROOM_ID.test(params.roomId)) throw notFound()
    const options = roomProjectionQueryOptions(params.roomId)
    // The rail's identity is not what a viewer came here for: an anonymous
    // pre-admission viewer is a supported state, so a failed session read is
    // reported and then treated as one rather than losing the whole room.
    const session = getRouteSession().catch((error: unknown) => {
      console.error('Room rail session read failed', error)
      return null
    })
    const room = await context.queryClient.ensureQueryData(options)
    if (!room) throw notFound({ data: { session: await session } })
    return { room, session: await session }
  },
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }],
  }),
  component: Room,
  notFoundComponent: RoomNotFoundBoundary,
})

function Room() {
  const { room, session } = Route.useLoaderData()
  const { roomId } = Route.useParams()
  return <RoomRoute initialRoom={room} roomId={roomId} session={session} />
}
function RoomNotFoundBoundary({ data }: Readonly<{ data?: unknown }>) {
  const session =
    data && typeof data === 'object' && 'session' in data
      ? (data.session as SessionProjection | null)
      : null
  return <RoomNotFound session={session} />
}
