import { and, eq, isNull } from 'drizzle-orm'
import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { db } from '#/db'
import { chatMessages, reports, roomMemberships, rooms, streamSessions, user } from '#/db/schema'
import { logEvent } from './logger'
import { isPlatformAdminUser } from './admin'
import { auth } from './auth'
import {
  banRoomMember,
  clearRoomBan,
  createReport,
  createSanction,
  hasEffectiveSanction,
  liftSanction,
  ModerationServiceError,
} from './moderation'
import { createRoom, joinRoom, leaveRoom, RoomServiceError } from './rooms'
import {
  canStartStreamFromUserAgent,
  startStream,
  stopStream,
  storeThumbnail,
  StreamServiceError,
} from './streams'
import {
  enforceRateLimit,
  RateLimitError,
  rateLimitKeys,
  rateLimitRules,
} from './rate-limit'

const roomCreateSchema = z.object({
  name: z.string().min(3).max(80),
  category: z.string().min(1),
  tags: z.array(z.string().max(24)).max(5),
  visibility: z.enum(['public', 'private']),
  password: z.string().optional(),
})

const roomJoinSchema = z.object({
  roomId: z.string().min(1),
  password: z.string().optional(),
})
const roomLeaveSchema = z.object({
  roomId: z.string().min(1),
})

const chatSendSchema = z.object({
  roomId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
})
const reportCreateSchema = z.object({
  roomId: z.string().min(1).optional(),
  targetType: z.enum(['account', 'room', 'stream_session', 'chat_message']),
  targetId: z.string().min(1),
  reason: z.string().trim().min(1).max(120),
  details: z.string().trim().max(4000).optional(),
})
const platformSanctionTypeSchema = z.enum([
  'stream_ban',
  'chat_ban',
  'room_creation_ban',
  'full_suspension',
])
const adminEndRoomSchema = z.object({
  roomId: z.string().min(1),
  reason: z.string().optional(),
})

const adminResolveReportSchema = z.object({
  reportId: z.string().min(1),
  resolution: z.enum(['resolved', 'dismissed']),
  note: z.string().optional(),
})

const adminCreateSanctionSchema = z.object({
  userId: z.string().min(1),
  type: platformSanctionTypeSchema,
  reason: z.string().trim().min(1).max(500),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
})
const adminLiftSanctionSchema = z.object({
  sanctionId: z.string().min(1),
})

const streamStartSchema = z.object({
  roomId: z.string().min(1),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  displaySurface: z.string().optional(),
  label: z.string().optional(),
})

const streamStopSchema = z.object({
  roomId: z.string().min(1),
  streamSessionId: z.string().min(1),
})

const watchSchema = z.object({
  roomId: z.string().min(1),
  streamSessionId: z.string().min(1),
})

const streamThumbnailSchema = z.object({
  roomId: z.string().min(1),
  streamSessionId: z.string().min(1),
  contentType: z.enum(['image/webp', 'image/jpeg']),
  byteLength: z.number().int().nonnegative(),
  data: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
})


const hostStopStreamSchema = z.object({
  roomId: z.string().min(1),
  streamSessionId: z.string().min(1),
})

const hostBanMemberSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1),
  reason: z.string().optional(),
})

const hostClearBanSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1),
})
const signalBaseSchema = z.object({
  roomId: z.string().min(1),
  streamSessionId: z.string().min(1),
  targetSocketId: z.string().min(1),
})
const requiredSignalValue = z.unknown().refine((value) => value !== undefined)
const signalDescriptionSchema = signalBaseSchema.extend({
  description: requiredSignalValue,
})
const signalCandidateSchema = signalBaseSchema.extend({
  candidate: requiredSignalValue,
})

type Ack<T> = (
  value: { ok: true; data?: T } | { ok: false; code: string; message: string },
) => void
type SocketUserResolver = (
  socket: Socket,
) => Promise<string | null> | string | null

async function sessionSocketUserId(socket: Socket) {
  const headers = new Headers()

  for (const [key, value] of Object.entries(socket.handshake.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(','))
    else if (value) headers.set(key, value)
  }
  const session = await auth.api.getSession({ headers })
  return session?.user.id ?? null
}

function adminAllowlist() {
  return (process.env.ADMIN_DISCORD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function roomChannel(roomId: string) {
  return `room:${roomId}`
}

function fail(ack: Ack<unknown>, code: string) {
  logEvent('socket:command:reject', { errorCode: code })
  ack({ ok: false, code, message: code })
}

async function allowRateLimit(
  ack: Ack<unknown>,
  key: string,
  rule: { limit: number; windowMs: number },
) {
  try {
    await enforceRateLimit(key, rule)
    return true
  } catch (error) {
    if (error instanceof RateLimitError) {
      fail(ack, error.code)
      return false
    }
    throw error
  }
}

async function loadActiveStreamInRoom(streamSessionId: string, roomId: string) {
  const rows = await db
    .select()
    .from(streamSessions)
    .where(
      and(
        eq(streamSessions.id, streamSessionId),
        eq(streamSessions.roomId, roomId),
        isNull(streamSessions.endedAt),
      ),
    )
    .limit(1)
  return rows.at(0)
}

async function isActiveStreamInRoom(streamSessionId: string, roomId: string) {
  return (await loadActiveStreamInRoom(streamSessionId, roomId)) !== undefined
}

function thumbnailBuffer(data: ArrayBuffer | Uint8Array) {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export function registerRealtime(
  io: Server,
  options: {
    resolveUserId?: SocketUserResolver
    isPlatformAdmin?: (userId: string) => Promise<boolean> | boolean
  } = {},
) {
  const resolveUserId = options.resolveUserId ?? sessionSocketUserId
  const isPlatformAdmin =
    options.isPlatformAdmin ??
    ((userId: string) => isPlatformAdminUser(userId, adminAllowlist()))
  const streamSockets = new Map<string, string>()
  const userSockets = new Map<string, Set<string>>()
  const presenceSockets = new Map<string, Set<string>>()
  const joinedRoomsBySocket = new Map<string, Set<string>>()

  function emitPresence() {
    io.emit('site:presence', { connectedUsers: presenceSockets.size })
  }

  function presenceIdentity(socket: Socket, userId: string | null | undefined) {
    if (userId) return `user:${userId}`
    const visitorId = socket.handshake.auth.visitorId
    return typeof visitorId === 'string' && visitorId.trim()
      ? `anon:${visitorId.trim()}`
      : `socket:${socket.id}`
  }

  function rememberPresence(socket: Socket, userId: string | null | undefined) {
    const identity = presenceIdentity(socket, userId)
    const sockets = presenceSockets.get(identity) ?? new Set<string>()
    sockets.add(socket.id)
    presenceSockets.set(identity, sockets)
    socket.emit('site:presence', { connectedUsers: presenceSockets.size })
    emitPresence()
    socket.once('disconnect', () => {
      sockets.delete(socket.id)
      if (sockets.size === 0) presenceSockets.delete(identity)
      emitPresence()
    })
  }

  function rememberUserSocket(userId: string, socket: Socket) {
    const sockets = userSockets.get(userId) ?? new Set<string>()
    sockets.add(socket.id)
    userSockets.set(userId, sockets)
    socket.once('disconnect', () => {
      sockets.delete(socket.id)
      if (sockets.size === 0) userSockets.delete(userId)
    })
  }
  function emitToUser(userId: string, event: string, payload: unknown) {
    for (const socketId of userSockets.get(userId) ?? []) {
      io.sockets.sockets.get(socketId)?.emit(event, payload)
    }
  }

  async function userSummary(userId: string) {
    const rows = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return rows[0] ?? { id: userId, name: userId }
  }

  function rememberJoinedRoom(socket: Socket, roomId: string) {
    const roomsForSocket = joinedRoomsBySocket.get(socket.id) ?? new Set<string>()
    roomsForSocket.add(roomId)
    joinedRoomsBySocket.set(socket.id, roomsForSocket)
  }

  async function leaveJoinedRoom(socket: Socket, userId: string, roomId: string) {
    const channel = roomChannel(roomId)
    const left = await leaveRoom({ userId, roomId })
    if (left.room.state === 'empty_grace') {
      io.to(channel).emit('room:emptyGraceStarted', {
        room: left.room,
        emptyGraceEndsAt: left.room.emptySince,
      })
      io.to('discovery').emit('discovery:roomUpdated', { room: left.room })
    } else if (left.room.currentHostUserId !== userId) {
      io.to(channel).emit('host:changed', {
        room: left.room,
        previousHostUserId: userId,
        currentHostUserId: left.room.currentHostUserId,
      })
      io.to('discovery').emit('discovery:roomUpdated', { room: left.room })
    }
    socket.to(channel).emit('member:left', {
      room: left.room,
      userId,
      leftAt: left.membership.leftAt,
    })
    return left
  }

  async function leaveAllJoinedRooms(socket: Socket, userId: string) {
    const roomIds = joinedRoomsBySocket.get(socket.id)
    if (!roomIds) return
    joinedRoomsBySocket.delete(socket.id)
    for (const roomId of roomIds) {
      try {
        await leaveJoinedRoom(socket, userId, roomId)
      } catch (error) {
        if (!(error instanceof RoomServiceError)) throw error
      }
    }
  }

  io.on('connection', (socket) => {
    void Promise.resolve(resolveUserId(socket)).then((userId) => {
      rememberPresence(socket, userId)
      if (userId) {
        rememberUserSocket(userId, socket)
        socket.once('disconnecting', () => {
          void leaveAllJoinedRooms(socket, userId)
        })
      }
    })
    socket.on('discovery:join', async (_payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (await hasEffectiveSanction(userId, 'full_suspension')) {
        return fail(ack, 'FULLY_SUSPENDED')
      }

      const roomRows = await db.select().from(rooms)
      await socket.join('discovery')
      ack({ ok: true, data: { rooms: roomRows } })
    })

    socket.on('discovery:leave', async (_payload, ack: Ack<unknown>) => {
      await socket.leave('discovery')
      ack({ ok: true })
    })

    socket.on('room:create', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = roomCreateSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      try {
        const created = await createRoom({ userId, input: parsed.data })
        await socket.join(roomChannel(created.room.id))
        ack({ ok: true, data: { room: created.room } })
        io.to('discovery').emit('discovery:roomCreated', { room: created.room })
      } catch (error) {
        if (error instanceof RoomServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('room:join', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = roomJoinSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      try {
        const joined = await joinRoom({
          userId,
          ...parsed.data,
          ipAddress: socket.handshake.address,
        })
        const channel = roomChannel(parsed.data.roomId)
        await socket.join(channel)
        rememberJoinedRoom(socket, parsed.data.roomId)
        ack({ ok: true, data: joined })
        if (joined.room.currentHostUserId === userId && joined.members.length === 1) {
          io.to(channel).emit('room:revived', { room: joined.room })
          io.to('discovery').emit('discovery:roomRevived', { room: joined.room })
          io.to(channel).emit('host:changed', {
            room: joined.room,
            currentHostUserId: userId,
          })
        }
        socket.to(channel).emit('member:joined', {
          room: joined.room,
          member:
            joined.members.find((member) => member.id === joined.membership.id) ??
            joined.membership,
        })
      } catch (error) {
        if (error instanceof RoomServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('room:leave', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = roomLeaveSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')

      try {
        const left = await leaveJoinedRoom(socket, userId, parsed.data.roomId)
        joinedRoomsBySocket.get(socket.id)?.delete(parsed.data.roomId)
        ack({ ok: true, data: { room: left.room } })
        await socket.leave(channel)
      } catch (error) {
        if (error instanceof RoomServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('chat:send', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = chatSendSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      if (
        !(await allowRateLimit(
          ack,
          rateLimitKeys.chatMessage(userId, parsed.data.roomId),
          rateLimitRules.chatMessage,
        ))
      ) {
        return
      }
      if (await hasEffectiveSanction(userId, 'full_suspension')) {
        return fail(ack, 'FULLY_SUSPENDED')
      }
      if (await hasEffectiveSanction(userId, 'chat_ban')) {
        return fail(ack, 'CHAT_BANNED')
      }

      const [message] = await db
        .insert(chatMessages)
        .values({
          roomId: parsed.data.roomId,
          userId,
          body: parsed.data.body,
        })
        .returning()

      const messageUser = await userSummary(userId)
      const event = {
        message: { ...message, user: messageUser },
      }
      ack({ ok: true, data: event })
      io.to(channel).emit('chat:message', event)
    })

    socket.on('stream:start', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = streamStartSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      if (
        !(await allowRateLimit(
          ack,
          rateLimitKeys.streamCommand(userId, parsed.data.roomId),
          rateLimitRules.streamCommand,
        ))
      ) {
        return
      }

      const userAgent = socket.handshake.headers['user-agent']
      const userAgentValue = Array.isArray(userAgent)
        ? userAgent.join(' ')
        : (userAgent ?? '')
      if (!canStartStreamFromUserAgent(userAgentValue)) {
        return fail(ack, 'UNSUPPORTED_BROWSER')
      }

      try {
        const stream = await startStream({ userId, ...parsed.data })
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, parsed.data.roomId))
          .limit(1)
        const streamUser = await userSummary(userId)
        const streamEvent = { ...stream, user: streamUser }
        streamSockets.set(stream.id, socket.id)
        ack({ ok: true, data: { stream: streamEvent } })
        io.to(channel).emit('stream:started', {
          room,
          stream: streamEvent,
          streamerSocketId: socket.id,
        })
        io.to('discovery').emit('discovery:roomUpdated', { room })
      } catch (error) {
        if (error instanceof StreamServiceError) return fail(ack, error.code)
        return fail(ack, 'STREAM_ALREADY_ACTIVE')
      }
    })

    socket.on('watch:start', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = watchSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')

      const stream = await loadActiveStreamInRoom(
        parsed.data.streamSessionId,
        parsed.data.roomId,
      )
      if (stream === undefined) return fail(ack, 'STREAM_NOT_ACTIVE')

      const streamerSocketId = streamSockets.get(stream.id)
      const streamerSocket = streamerSocketId
        ? io.sockets.sockets.get(streamerSocketId)
        : undefined
      if (!streamerSocket || !streamerSocket.rooms.has(channel)) {
        return fail(ack, 'TARGET_SOCKET_NOT_FOUND')
      }

      ack({ ok: true, data: { stream, streamerSocketId } })
    })

    socket.on('watch:stop', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = watchSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')

      const stream = await loadActiveStreamInRoom(
        parsed.data.streamSessionId,
        parsed.data.roomId,
      )
      if (stream === undefined) return fail(ack, 'STREAM_NOT_ACTIVE')

      ack({ ok: true })
    })

    socket.on('stream:stop', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = streamStopSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      if (
        !(await allowRateLimit(
          ack,
          rateLimitKeys.streamCommand(userId, parsed.data.roomId),
          rateLimitRules.streamCommand,
        ))
      ) {
        return
      }

      try {
        const stream = await stopStream({
          streamSessionId: parsed.data.streamSessionId,
          roomId: parsed.data.roomId,
          userId,
          reason: 'self',
        })
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, parsed.data.roomId))
          .limit(1)
        ack({ ok: true })
        streamSockets.delete(parsed.data.streamSessionId)
        io.to(channel).emit('stream:stopped', {
          room,
          streamSessionId: parsed.data.streamSessionId,
          userId,
          stoppedAt: stream.endedAt,
          reason: 'self',
        })
        io.to('discovery').emit('discovery:roomUpdated', { room })
      } catch (error) {
        if (error instanceof StreamServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('stream:thumbnail', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = streamThumbnailSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')

      const bytes = thumbnailBuffer(parsed.data.data)
      if (bytes.byteLength !== parsed.data.byteLength) {
        return fail(ack, 'VALIDATION_FAILED')
      }

      try {
        const stream = await storeThumbnail({
          streamSessionId: parsed.data.streamSessionId,
          roomId: parsed.data.roomId,
          userId,
          thumbnail: { contentType: parsed.data.contentType, bytes },
        })
        const event = {
          streamSessionId: parsed.data.streamSessionId,
          thumbnailUpdatedAt: stream.thumbnailUpdatedAt,
        }
        ack({ ok: true, data: event })
        io.to(channel).emit('stream:thumbnailUpdated', event)
      } catch (error) {
        if (error instanceof StreamServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('host:stopStream', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      const parsed = hostStopStreamSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')
      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      const roomRows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, parsed.data.roomId))
        .limit(1)
      const room = roomRows.at(0)
      if (!room || room.currentHostUserId !== userId) return fail(ack, 'NOT_HOST')
      const activeStreamRows = await db
        .select()
        .from(streamSessions)
        .where(
          and(
            eq(streamSessions.id, parsed.data.streamSessionId),
            eq(streamSessions.roomId, parsed.data.roomId),
            isNull(streamSessions.endedAt),
          ),
        )
        .limit(1)
      const activeStream = activeStreamRows.at(0)
      if (!activeStream) return fail(ack, 'STREAM_NOT_ACTIVE')
      try {
        const stream = await stopStream({
          streamSessionId: parsed.data.streamSessionId,
          roomId: parsed.data.roomId,
          userId: activeStream.userId,
          reason: 'host',
        })
        streamSockets.delete(parsed.data.streamSessionId)
        ack({ ok: true })
        io.to(channel).emit('stream:stopped', {
          room,
          streamSessionId: parsed.data.streamSessionId,
          userId: activeStream.userId,
          stoppedAt: stream.endedAt,
          reason: 'host',
        })
        io.to('discovery').emit('discovery:roomUpdated', { room })
      } catch (error) {
        if (error instanceof StreamServiceError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('host:banMember', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      const parsed = hostBanMemberSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')
      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      const roomRows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, parsed.data.roomId))
        .limit(1)
      const room = roomRows.at(0)
      if (!room || room.currentHostUserId !== userId) return fail(ack, 'NOT_HOST')
      const targetMembershipRows = await db
        .select()
        .from(roomMemberships)
        .where(
          and(
            eq(roomMemberships.roomId, parsed.data.roomId),
            eq(roomMemberships.userId, parsed.data.targetUserId),
            isNull(roomMemberships.leftAt),
          ),
        )
        .limit(1)
      const targetMembership = targetMembershipRows.at(0)
      if (!targetMembership) return fail(ack, 'TARGET_NOT_IN_ROOM')
      const ban = await banRoomMember({
        roomId: parsed.data.roomId,
        targetUserId: parsed.data.targetUserId,
        bannedByUserId: userId,
        reason: parsed.data.reason,
      })
      ack({ ok: true, data: { bannedUserId: parsed.data.targetUserId } })
      io.to(channel).emit('member:banned', {
        roomId: parsed.data.roomId,
        bannedUserId: parsed.data.targetUserId,
        bannedByUserId: userId,
        createdAt: ban.createdAt,
      })
      io.to(channel).emit('member:left', {
        room,
        userId: parsed.data.targetUserId,
        leftAt: ban.createdAt,
      })
    })

    socket.on('host:clearBan', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      const parsed = hostClearBanSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')
      const channel = roomChannel(parsed.data.roomId)
      if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
      const roomRows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, parsed.data.roomId))
        .limit(1)
      const room = roomRows.at(0)
      if (!room || room.currentHostUserId !== userId) return fail(ack, 'NOT_HOST')
      const ban = await clearRoomBan({
        roomId: parsed.data.roomId,
        targetUserId: parsed.data.targetUserId,
        clearedByUserId: userId,
      })
      if (!ban) return fail(ack, 'NOT_FOUND')
      ack({ ok: true, data: { clearedUserId: parsed.data.targetUserId } })
      io.to(channel).emit('ban:cleared', {
        roomId: parsed.data.roomId,
        clearedUserId: parsed.data.targetUserId,
        clearedByUserId: userId,
        clearedAt: ban.clearedAt,
      })
    })

    socket.on('report:create', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')

      const parsed = reportCreateSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      try {
        const report = await createReport({
          reporterUserId: userId,
          ...parsed.data,
        })
        ack({ ok: true, data: { report } })
        io.to('admin').emit('admin:reportCreated', { report })
      } catch (error) {
        if (error instanceof ModerationServiceError)
          return fail(ack, error.code)
        if (error instanceof RateLimitError) return fail(ack, error.code)
        throw error
      }
    })

    socket.on('admin:join', async (_payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (!(await isPlatformAdmin(userId))) return fail(ack, 'NOT_PLATFORM_ADMIN')
      const [liveRooms, openReports] = await Promise.all([
        db.select().from(rooms).where(eq(rooms.state, 'live')),
        db.select().from(reports).where(isNull(reports.resolvedAt)),
      ])
      await socket.join('admin')
      await socket.join('discovery')
      ack({ ok: true, data: { liveRooms, openReports } })
    })

    socket.on('admin:endRoom', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (!(await isPlatformAdmin(userId))) return fail(ack, 'NOT_PLATFORM_ADMIN')
      const parsed = adminEndRoomSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')
      const now = new Date()
      const roomRows = await db
        .update(rooms)
        .set({ state: 'ended', endedAt: now })
        .where(eq(rooms.id, parsed.data.roomId))
        .returning()
      const room = roomRows.at(0)
      if (!room) return fail(ack, 'NOT_FOUND')
      const activeStreams = await db
        .update(streamSessions)
        .set({ endedAt: now, stopReason: 'room_ended' })
        .where(and(eq(streamSessions.roomId, parsed.data.roomId), isNull(streamSessions.endedAt)))
        .returning()
      ack({ ok: true, data: { room } })
      io.to(roomChannel(parsed.data.roomId)).emit('room:ended', { room })
      io.to('discovery').emit('discovery:roomEnded', { room })
      for (const stream of activeStreams) {
        streamSockets.delete(stream.id)
        io.to(roomChannel(parsed.data.roomId)).emit('stream:stopped', {
          room,
          streamSessionId: stream.id,
          userId: stream.userId,
          stoppedAt: stream.endedAt,
          reason: 'room_ended',
        })
      }
    })

    socket.on('admin:resolveReport', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (!(await isPlatformAdmin(userId))) return fail(ack, 'NOT_PLATFORM_ADMIN')
      const parsed = adminResolveReportSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')
      const reportRows = await db
        .update(reports)
        .set({
          resolvedAt: new Date(),
        })
        .where(and(eq(reports.id, parsed.data.reportId), isNull(reports.resolvedAt)))
        .returning()
      const report = reportRows.at(0)
      if (!report) return fail(ack, 'NOT_FOUND')
      ack({ ok: true, data: { report } })
      io.to('admin').emit('admin:reportResolved', { report })
    })

    socket.on('admin:createSanction', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (!(await isPlatformAdmin(userId)))
        return fail(ack, 'NOT_PLATFORM_ADMIN')

      const parsed = adminCreateSanctionSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      try {
        const sanction = await createSanction({
          createdByUserId: userId,
          ...parsed.data,
        })
        ack({ ok: true, data: { sanction } })
        io.to('admin').emit('admin:sanctionCreated', { sanction })
        emitToUser(sanction.userId, 'sanction:created', { sanction })
      } catch {
        return fail(ack, 'NOT_FOUND')
      }
    })

    socket.on('admin:liftSanction', async (payload, ack: Ack<unknown>) => {
      const userId = await resolveUserId(socket)
      if (!userId) return fail(ack, 'UNAUTHENTICATED')
      if (!(await isPlatformAdmin(userId)))
        return fail(ack, 'NOT_PLATFORM_ADMIN')

      const parsed = adminLiftSanctionSchema.safeParse(payload)
      if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

      try {
        const sanction = await liftSanction({
          sanctionId: parsed.data.sanctionId,
          liftedByUserId: userId,
        })
        ack({ ok: true, data: { sanction } })
        io.to('admin').emit('admin:sanctionLifted', { sanction })
        emitToUser(sanction.userId, 'sanction:lifted', { sanction })
      } catch (error) {
        if (error instanceof ModerationServiceError)
          return fail(ack, error.code)
        throw error
      }
    })
    for (const eventName of [
      'signal:offer',
      'signal:answer',
      'signal:iceCandidate',
    ] as const) {
      socket.on(eventName, async (payload, ack: Ack<unknown>) => {
        const userId = await resolveUserId(socket)
        if (!userId) return fail(ack, 'UNAUTHENTICATED')

        const parsed =
          eventName === 'signal:iceCandidate'
            ? signalCandidateSchema.safeParse(payload)
            : signalDescriptionSchema.safeParse(payload)
        if (!parsed.success) return fail(ack, 'VALIDATION_FAILED')

        const channel = roomChannel(parsed.data.roomId)
        if (!socket.rooms.has(channel)) return fail(ack, 'NOT_IN_ROOM')
        if (
          !(await isActiveStreamInRoom(
            parsed.data.streamSessionId,
            parsed.data.roomId,
          ))
        )
          return fail(ack, 'STREAM_NOT_ACTIVE')

        const target = io.sockets.sockets.get(parsed.data.targetSocketId)
        if (!target) return fail(ack, 'TARGET_SOCKET_NOT_FOUND')
        if (!target.rooms.has(channel)) return fail(ack, 'TARGET_NOT_IN_ROOM')

        ack({ ok: true })
        target.emit(eventName, {
          ...parsed.data,
          fromSocketId: socket.id,
          fromUserId: userId,
        })
      })
    }
  })
}
