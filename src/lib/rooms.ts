import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import {
  chatMessages,
  roomBans,
  roomMemberships,
  rooms,
  streamSessions,
  user,
} from '#/db/schema'
import { isPlatformAdminUser } from './admin'
import { logEvent } from './logger'
import { hasEffectiveSanction } from './moderation'
import {
  enforceRateLimit,
  RateLimitError,
  rateLimitKeys,
  rateLimitRules,
} from './rate-limit'

const createRoomInputSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    category: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(24)).max(5),
    visibility: z.enum(['public', 'private']),
    password: z.string().min(1).optional(),
  })
  .refine((value) => value.visibility === 'public' || value.password, {
    message: 'Private rooms require a password',
    path: ['password'],
  })

export class RoomServiceError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

type CreateRoomInput = z.infer<typeof createRoomInputSchema>

function hashRoomPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyRoomPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  const actual = scryptSync(password, salt, 32)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function loadJoinSnapshot(roomId: string) {
  const [members, streams, recentMessages] = await Promise.all([
    db
      .select({ membership: roomMemberships, user })
      .from(roomMemberships)
      .innerJoin(user, eq(user.id, roomMemberships.userId))
      .where(
        and(eq(roomMemberships.roomId, roomId), isNull(roomMemberships.leftAt)),
      )
      .orderBy(asc(roomMemberships.joinedAt)),
    db
      .select({ stream: streamSessions, user })
      .from(streamSessions)
      .innerJoin(user, eq(user.id, streamSessions.userId))
      .where(
        and(eq(streamSessions.roomId, roomId), isNull(streamSessions.endedAt)),
      )
      .orderBy(asc(streamSessions.startedAt)),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(50),
  ])

  return {
    members: members.map(({ membership, user: memberUser }) => ({
      ...membership,
      user: { id: memberUser.id, name: memberUser.name },
    })),
    streams: streams.map(({ stream, user: streamUser }) => ({
      ...stream,
      user: { id: streamUser.id, name: streamUser.name },
    })),
    recentMessages: [...recentMessages].reverse(),
  }
}

export async function loadRoomTranscript({
  roomId,
  userId,
  adminDiscordIds,
}: {
  roomId: string
  userId: string
  adminDiscordIds: readonly string[]
}) {
  const roomRows = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  const room = roomRows.at(0)
  if (room === undefined) throw new RoomServiceError('NOT_FOUND')
  if (room.state !== 'ended') throw new RoomServiceError('ROOM_NOT_ENDED')

  const isHost =
    room.createdByUserId === userId || room.currentHostUserId === userId
  const isAdmin = await isPlatformAdminUser(userId, adminDiscordIds)
  if (!isHost && !isAdmin) throw new RoomServiceError('FORBIDDEN')

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt))

  return { room, messages }
}

export async function createRoom({
  userId,
  input,
}: {
  userId: string
  input: CreateRoomInput
}) {
  const parsed = createRoomInputSchema.parse(input)
  try {
    await enforceRateLimit(
      rateLimitKeys.roomCreate(userId),
      rateLimitRules.roomCreate,
    )
  } catch (error) {
    if (error instanceof RateLimitError)
      throw new RoomServiceError('RATE_LIMITED')
    throw error
  }
  if (await hasEffectiveSanction(userId, 'full_suspension')) {
    throw new RoomServiceError('FULLY_SUSPENDED')
  }
  if (await hasEffectiveSanction(userId, 'room_creation_ban')) {
    throw new RoomServiceError('ROOM_CREATION_BANNED')
  }

  const created = await db.transaction(async (tx) => {
    const [room] = await tx
      .insert(rooms)
      .values({
        name: parsed.name,
        category: parsed.category,
        tags: parsed.tags,
        visibility: parsed.visibility,
        passwordHash: parsed.password
          ? hashRoomPassword(parsed.password)
          : null,
        createdByUserId: userId,
        currentHostUserId: userId,
      })
      .returning()

    const [membership] = await tx
      .insert(roomMemberships)
      .values({ roomId: room.id, userId })
      .returning()

    return { room, membership }
  })
  logEvent('room:create', { roomId: created.room.id, userId })
  return created
}

export async function joinRoom({
  userId,
  roomId,
  password,
  ipAddress,
}: {
  userId: string
  roomId: string
  password?: string
  ipAddress?: string
}) {
  if (await hasEffectiveSanction(userId, 'full_suspension'))
    throw new RoomServiceError('FULLY_SUSPENDED')
  const roomRows = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (roomRows.length === 0) throw new RoomServiceError('NOT_FOUND')
  let room = roomRows[0]
  if (room.state === 'ended') throw new RoomServiceError('ROOM_NOT_LIVE')
  if (room.state === 'empty_grace') {
    const [revived] = await db
      .update(rooms)
      .set({ state: 'live', emptySince: null, currentHostUserId: userId })
      .where(eq(rooms.id, roomId))
      .returning()
    room = revived
    logEvent('room:revive', { roomId, userId })
  }
  if (room.state !== 'live') throw new RoomServiceError('ROOM_NOT_LIVE')

  const activeBans = await db
    .select({ id: roomBans.id })
    .from(roomBans)
    .where(
      and(
        eq(roomBans.roomId, roomId),
        eq(roomBans.bannedUserId, userId),
        isNull(roomBans.clearedAt),
      ),
    )
    .limit(1)
  if (activeBans.length > 0) throw new RoomServiceError('ROOM_BANNED')

  if (room.visibility === 'private') {
    if (!password) throw new RoomServiceError('PASSWORD_REQUIRED')
    try {
      await enforceRateLimit(
        rateLimitKeys.privateRoomPassword(
          userId,
          roomId,
          ipAddress ?? 'unknown',
        ),
        rateLimitRules.privateRoomPassword,
      )
    } catch (error) {
      if (error instanceof RateLimitError)
        throw new RoomServiceError('RATE_LIMITED')
      throw error
    }
    if (
      !room.passwordHash ||
      !verifyRoomPassword(password, room.passwordHash)
    ) {
      throw new RoomServiceError('INVALID_PASSWORD')
    }
  }

  const joined = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomId}))`)
    const activeMemberships = await tx
      .select({ id: roomMemberships.id, userId: roomMemberships.userId })
      .from(roomMemberships)
      .where(
        and(eq(roomMemberships.roomId, roomId), isNull(roomMemberships.leftAt)),
      )

    const existing = activeMemberships.find(
      (membership) => membership.userId === userId,
    )
    if (existing) {
      const [membership] = await tx
        .select()
        .from(roomMemberships)
        .where(eq(roomMemberships.id, existing.id))
        .limit(1)
      return { room, membership }
    }

    if (activeMemberships.length >= 10) throw new RoomServiceError('ROOM_FULL')

    const [membership] = await tx
      .insert(roomMemberships)
      .values({ roomId, userId })
      .returning()

    return { room, membership }
  })

  logEvent('room:join', { roomId, userId })
  return { ...joined, ...(await loadJoinSnapshot(roomId)) }
}

export async function expireEmptyGraceRooms(now = new Date()) {
  const expiresBefore = new Date(now.getTime() - 5 * 60 * 1000)
  const expired = await db
    .update(rooms)
    .set({ state: 'ended', endedAt: now, updatedAt: now })
    .where(
      and(eq(rooms.state, 'empty_grace'), lte(rooms.emptySince, expiresBefore)),
    )
    .returning()

  for (const room of expired) {
    logEvent('room:end', { roomId: room.id })
  }

  return expired
}

export async function leaveRoom({
  userId,
  roomId,
}: {
  userId: string
  roomId: string
}) {
  const now = new Date()
  const membershipRows = await db
    .update(roomMemberships)
    .set({ leftAt: now })
    .where(
      and(
        eq(roomMemberships.roomId, roomId),
        eq(roomMemberships.userId, userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .returning()
  const membership = membershipRows.at(0)
  if (membership === undefined) throw new RoomServiceError('NOT_IN_ROOM')

  const remaining = await db
    .select()
    .from(roomMemberships)
    .where(
      and(eq(roomMemberships.roomId, roomId), isNull(roomMemberships.leftAt)),
    )
    .orderBy(asc(roomMemberships.joinedAt))

  const roomRows = await db.select().from(rooms).where(eq(rooms.id, roomId))
  const currentRoom = roomRows.at(0)
  if (currentRoom === undefined) throw new RoomServiceError('NOT_FOUND')

  const nextHostUserId =
    remaining.length > 0 ? remaining[0].userId : currentRoom.currentHostUserId
  let room = currentRoom
  if (remaining.length === 0 || currentRoom.currentHostUserId === userId) {
    const [updated] = await db
      .update(rooms)
      .set(
        remaining.length === 0
          ? { state: 'empty_grace', emptySince: now }
          : { currentHostUserId: nextHostUserId },
      )
      .where(eq(rooms.id, roomId))
      .returning()
    room = updated
  }

  logEvent('room:leave', { roomId, userId })
  if (remaining.length === 0) {
    logEvent('room:empty-grace:start', { roomId, userId })
  } else if (currentRoom.currentHostUserId === userId) {
    logEvent('room:host-handoff', {
      roomId,
      userId,
      targetUserId: nextHostUserId,
    })
  }

  return { room, membership }
}
