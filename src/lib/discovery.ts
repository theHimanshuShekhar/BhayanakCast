import { desc, eq, inArray, isNull } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { db } from '#/db'
import { roomMemberships, rooms, streamSessions, user } from '#/db/schema'

export type DiscoveryRoom = {
  id: string
  name: string
  host: string
  category: string
  tags: string[]
  members: number
  streams: number
  private: boolean
  state: 'live' | 'ended'
  endedAt: string | null
}

export function filterDiscoveryRooms(items: DiscoveryRoom[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return items

  return items.filter((room) =>
    [room.name, room.host, room.category, ...room.tags].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  )
}

export function splitDiscoveryRooms(items: DiscoveryRoom[]) {
  return {
    liveRooms: items.filter((room) => room.state === 'live'),
    pastRooms: items.filter((room) => room.state === 'ended'),
  }
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags))
    return tags.filter((tag): tag is string => typeof tag === 'string')
  if (typeof tags === 'string')
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  return []
}

export const loadDiscoveryRooms = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const [roomRows, membershipRows, streamRows] = await Promise.all([
        db
          .select({ room: rooms, hostName: user.name })
          .from(rooms)
          .leftJoin(user, eq(rooms.currentHostUserId, user.id))
          .where(inArray(rooms.state, ['live', 'ended']))
          .orderBy(desc(rooms.updatedAt))
          .limit(48),
        db.select().from(roomMemberships).where(isNull(roomMemberships.leftAt)),
        db.select().from(streamSessions).where(isNull(streamSessions.endedAt)),
      ])

      if (roomRows.length === 0) return []

      return roomRows.map((row): DiscoveryRoom => {
        const room = row.room

        return {
          id: room.id,
          name: room.name,
          host: row.hostName ?? room.currentHostUserId,
          category: room.category,
          tags: normalizeTags(room.tags),
          members: membershipRows.filter(
            (membership) => membership.roomId === room.id,
          ).length,
          streams: streamRows.filter((stream) => stream.roomId === room.id)
            .length,
          private: room.visibility === 'private',
          state: room.state === 'ended' ? 'ended' : 'live',
          endedAt: room.endedAt?.toISOString() ?? null,
        }
      })
    } catch {
      return []
    }
  },
)
