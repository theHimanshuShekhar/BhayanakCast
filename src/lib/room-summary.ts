import { and, eq, isNull } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { db } from '#/db'
import { roomMemberships, rooms, streamSessions, user } from '#/db/schema'
import { auth } from '#/lib/auth'

const roomSummarySchema = z.object({ roomId: z.string().min(1) })

export type RoomSummary = {
  id: string
  name: string
  host: string
  visibility: 'public' | 'private'
  state: 'live' | 'empty_grace' | 'ended'
  members: number
  streams: number
  capacity: number
}

export type RoomSummaryState =
  | { authenticated: false; room: null }
  | { authenticated: true; room: RoomSummary | null }

export const loadRoomSummary = createServerFn({ method: 'GET' })
  .validator(roomSummarySchema)
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session) {
      return { authenticated: false, room: null } satisfies RoomSummaryState
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.roomId,
      )
    ) {
      return { authenticated: true, room: null } satisfies RoomSummaryState
    }
    const rows = await db
      .select({ room: rooms, hostName: user.name })
      .from(rooms)
      .leftJoin(user, eq(rooms.currentHostUserId, user.id))
      .where(eq(rooms.id, data.roomId))
      .limit(1)
    const row = rows.at(0)
    if (!row) {
      return { authenticated: true, room: null } satisfies RoomSummaryState
    }

    const room = row.room

    const [memberships, streams] = await Promise.all([
      db
        .select({ id: roomMemberships.id })
        .from(roomMemberships)
        .where(
          and(
            eq(roomMemberships.roomId, room.id),
            isNull(roomMemberships.leftAt),
          ),
        ),
      db
        .select({ id: streamSessions.id })
        .from(streamSessions)
        .where(
          and(
            eq(streamSessions.roomId, room.id),
            isNull(streamSessions.endedAt),
          ),
        ),
    ])

    return {
      authenticated: true,
      room: {
        id: room.id,
        name: room.name,
        host: row.hostName ?? room.currentHostUserId,
        visibility: room.visibility,
        state: room.state,
        members: memberships.length,
        streams: streams.length,
        capacity: 10,
      },
    } satisfies RoomSummaryState
  })
