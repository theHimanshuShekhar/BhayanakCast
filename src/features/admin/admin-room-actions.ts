import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readSessionProjection } from '../../server/auth/auth'
import { getProductionRoomService } from '../home/create-room'
import { PlatformAdminAuthorizationError } from '../../server/moderation/report-service'
import { recordModerationInteraction } from '../../server/moderation/moderation-observability'
import type { PlatformAdminRoomActor } from '../../server/rooms/room-service'

const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const getAdminLiveRooms = createServerFn({ method: 'GET' }).handler(async () => {
  const actor = await requireAdmin()
  const result = await getProductionRoomService().listAdminLiveRooms(actor)
  if (result.status !== 'ok') throw new PlatformAdminAuthorizationError()
  await recordModerationInteraction({
    name: 'admin_room_termination_list_viewed',
    properties: {},
  })
  return result.rooms
})

export const endAdminRoom = createServerFn({ method: 'POST' })
  .validator(validateRoomId)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    const result = await getProductionRoomService().adminEndRoom(actor, data)
    await recordModerationInteraction({
      name: 'admin_room_end_submitted',
      properties: { outcome: result.status },
    })
    return result
  })

async function requireAdmin(): Promise<PlatformAdminRoomActor> {
  const session = await readSessionProjection(
    getProductionAuth(),
    getRequest().headers,
  )
  if (!session?.isPlatformAdmin) throw new PlatformAdminAuthorizationError()
  return { accountId: session.id, isPlatformAdmin: true }
}

export function validateRoomId(value: unknown): string {
  if (typeof value !== 'string' || !ROOM_ID.test(value)) {
    throw new TypeError('Invalid room id')
  }
  return value.toLowerCase()
}
