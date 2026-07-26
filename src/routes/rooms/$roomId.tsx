import { createFileRoute, notFound } from '@tanstack/react-router'
import { RoomRoute } from '../../features/room/RoomRoute'
import { roomProjectionQueryOptions } from '../../features/room/room-queries'
import { RoomNotFound } from '../../features/room/RoomNotFound'
import { ROOM_ID } from '../../features/home/create-room'


export const Route = createFileRoute('/rooms/$roomId')({
  loader: async ({ context, params }) => {
    if (!ROOM_ID.test(params.roomId)) throw notFound()
    const options = roomProjectionQueryOptions(params.roomId)
    const room = await context.queryClient.ensureQueryData(options)
    if (!room) throw notFound()
    return { room }
  },
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }],
  }),
  component: Room,
  notFoundComponent: RoomNotFound,
})

function Room() {
  const { room } = Route.useLoaderData()
  const { roomId } = Route.useParams()
  return <RoomRoute initialRoom={room} roomId={roomId} />
}
