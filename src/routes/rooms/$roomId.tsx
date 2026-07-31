import { createFileRoute, notFound } from '@tanstack/react-router'
import { RoomRoute } from '../../features/room/RoomRoute'
import { roomProjectionQueryOptions } from '../../features/room/room-queries'
import { RoomNotFound } from '../../features/room/RoomNotFound'
import { ROOM_ID } from '../../features/home/create-room'
import { getRouteSession } from '../../server/auth/session-fn'


export const Route = createFileRoute('/rooms/$roomId')({
  loader: async ({ context, params }) => {
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
    if (!room) throw notFound()
    return { room, session: await session }
  },
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }],
  }),
  component: Room,
  notFoundComponent: RoomNotFound,
})

function Room() {
  const { room, session } = Route.useLoaderData()
  const { roomId } = Route.useParams()
  return <RoomRoute initialRoom={room} roomId={roomId} session={session} />
}
