import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket as ClientSocket } from 'socket.io-client'
import { io as createClient } from 'socket.io-client'
import { Server } from 'socket.io'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '#/db'
import {
  account,
  chatMessages,
  platformSanctions,
  roomMemberships,
  rooms,
  reports,
  streamSessions,
  user,
} from '#/db/schema'
import { createRoom } from './rooms'
import { createSanction } from './moderation'
import { registerRealtime } from './realtime'

const hostId = 'socket-host'
const guestId = 'socket-guest'
const adminId = 'socket-admin'

async function seedUser(id: string) {
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test`, emailVerified: true })
    .onConflictDoNothing()
}

async function clean() {
  await db.delete(reports)
  await db.delete(platformSanctions)
  await db.delete(streamSessions)
  await db.delete(chatMessages)
  await db.delete(roomMemberships)
  await db.delete(rooms)
  await db.delete(user)
}

async function makeClient(
  port: number,
  userId: string,
  userAgent = 'Mozilla/5.0 Chrome/120 Safari/537.36',
) {
  const socket = createClient(`http://localhost:${port}`, {
    auth: { userId },
    forceNew: true,
    transports: ['websocket'],
    extraHeaders: { 'user-agent': userAgent },
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}

async function emitAck<T>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
) {
  return (await socket.timeout(1000).emitWithAck(event, payload)) as T
}

beforeEach(async () => {
  await clean()
  await seedUser(hostId)
  await seedUser(guestId)
  await seedUser(adminId)
})

afterEach(async () => {
  await clean()
})

describe('registerRealtime', () => {
  test('creates rooms over socket and broadcasts discovery creation', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const host = await makeClient(port, hostId)
    const discovery = await makeClient(port, guestId)
    const discoveryAck = await emitAck<{ ok: true; data: { rooms: unknown[] } }>(
      discovery,
      'discovery:join',
      {},
    )
    const createdSeen = new Promise<{ room: { id: string; name: string } }>((resolve) => {
      discovery.once('discovery:roomCreated', resolve)
    })

    const createAck = await emitAck<{ ok: true; data: { room: { id: string; name: string } } }>(
      host,
      'room:create',
      {
        name: 'Socket created room',
        category: 'testing',
        tags: [],
        visibility: 'public',
      },
    )

    expect(discoveryAck).toMatchObject({ ok: true, data: { rooms: [] } })
    expect(createAck).toMatchObject({
      ok: true,
      data: { room: { name: 'Socket created room' } },
    })
    await expect(createdSeen).resolves.toMatchObject({
      room: { id: createAck.data.room.id, name: 'Socket created room' },
    })

    host.close()
    discovery.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('joins a room and broadcasts persisted chat messages', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'Socket room',
        category: 'testing',
        tags: [],
        visibility: 'public',
      },
    })

    const host = await makeClient(port, hostId)
    const guest = await makeClient(port, guestId)

    const joinAck = await emitAck<{ ok: true }>(guest, 'room:join', {
      roomId: created.room.id,
    })
    expect(joinAck.ok).toBe(true)

    const messageSeen = new Promise<{ message: { body: string } }>(
      (resolve) => {
        host.once('chat:message', resolve)
      },
    )

    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })
    const chatAck = await emitAck<{
      ok: true
      data: { message: { body: string } }
    }>(guest, 'chat:send', { roomId: created.room.id, body: 'hello room' })

    expect(chatAck).toMatchObject({ ok: true })
    expect(chatAck.data.message.body).toBe('hello room')
    await expect(messageSeen).resolves.toMatchObject({
      message: { body: 'hello room' },
    })

    const leaveAck = await emitAck<{ ok: true }>(guest, 'room:leave', {
      roomId: created.room.id,
    })
    expect(leaveAck).toMatchObject({ ok: true })
    const afterLeaveChatAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'chat:send',
      { roomId: created.room.id, body: 'after leave' },
    )
    expect(afterLeaveChatAck).toMatchObject({
      ok: false,
      code: 'NOT_IN_ROOM',
    })

    host.close()
    guest.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('broadcasts empty grace when the last room member leaves', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'Empty grace socket room',
        category: 'testing',
        tags: [],
        visibility: 'public',
      },
    })
    const host = await makeClient(port, hostId)

    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })
    const emptyGraceSeen = new Promise<{ room: { id: string }; emptyGraceEndsAt: string }>(
      (resolve) => {
        host.once('room:emptyGraceStarted', resolve)
      },
    )

    const leaveAck = await emitAck<{ ok: true }>(host, 'room:leave', {
      roomId: created.room.id,
    })

    expect(leaveAck).toMatchObject({ ok: true })
    await expect(emptyGraceSeen).resolves.toMatchObject({
      room: { id: created.room.id, state: 'empty_grace' },
    })

    host.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('creates validated reports over socket', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'Socket report room',
        category: 'testing',
        tags: [],
        visibility: 'public',
      },
    })
    const guest = await makeClient(port, guestId)

    const reportAck = await emitAck<{
      ok: true
      data: { report: { targetType: string; roomId: string } }
    }>(guest, 'report:create', {
      targetType: 'room',
      targetId: created.room.id,
      reason: 'unsafe room',
    })

    expect(reportAck).toMatchObject({
      ok: true,
      data: {
        report: { targetType: 'room', roomId: created.room.id },
      },
    })
    await expect(
      emitAck<{ ok: false; code: string }>(guest, 'report:create', {
        targetType: 'room',
        targetId: '00000000-0000-0000-0000-000000000000',
        reason: 'ghost room',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })

    guest.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('starts streams and relays WebRTC offers inside the room', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const host = await makeClient(port, hostId)
    const guest = await makeClient(port, guestId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'signal room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await emitAck<{ ok: true }>(guest, 'room:join', { roomId: created.room.id })
    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })
    const offerSeen = new Promise((resolve) =>
      host.once('signal:offer', resolve),
    )

    const startAck = await emitAck<{
      ok: true
      data: { stream: { id: string } }
    }>(host, 'stream:start', {
      roomId: created.room.id,
      hasVideo: true,
      hasAudio: true,
    })
    const offerAck = await emitAck<{ ok: true }>(guest, 'signal:offer', {
      roomId: created.room.id,
      streamSessionId: startAck.data.stream.id,
      targetSocketId: host.id,
      description: { type: 'offer', sdp: 'v=0' },
    })

    expect(startAck).toMatchObject({ ok: true })
    expect(offerAck).toMatchObject({ ok: true })
    await expect(offerSeen).resolves.toMatchObject({
      roomId: created.room.id,
      streamSessionId: startAck.data.stream.id,
      targetSocketId: host.id,
      fromSocketId: guest.id,
      fromUserId: guestId,
      description: { type: 'offer', sdp: 'v=0' },
    })

    const invalidOfferAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'signal:offer',
      {
        roomId: created.room.id,
        streamSessionId: startAck.data.stream.id,
        targetSocketId: host.id,
      },
    )
    expect(invalidOfferAck).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    })

    const otherRoom = await createRoom({
      userId: guestId,
      input: {
        name: 'other signal room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await emitAck<{ ok: true }>(guest, 'room:join', {
      roomId: otherRoom.room.id,
    })
    const wrongRoomAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'signal:offer',
      {
        roomId: otherRoom.room.id,
        streamSessionId: startAck.data.stream.id,
        targetSocketId: host.id,
        description: { type: 'offer', sdp: 'v=0' },
      },
    )
    expect(wrongRoomAck).toMatchObject({
      ok: false,
      code: 'STREAM_NOT_ACTIVE',
    })

    host.close()
    guest.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('starts and stops documented watch subscriptions', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const host = await makeClient(port, hostId)
    const guest = await makeClient(port, guestId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'watch room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })
    const notInRoomAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'watch:start',
      { roomId: created.room.id, streamSessionId: created.room.id },
    )
    await emitAck<{ ok: true }>(guest, 'room:join', { roomId: created.room.id })
    const streamStartedSeen = new Promise<{ room: { id: string }; stream: { id: string } }>(
      (resolve) => {
        guest.once('stream:started', resolve)
      },
    )
    const startAck = await emitAck<{
      ok: true
      data: { stream: { id: string } }
    }>(host, 'stream:start', {
      roomId: created.room.id,
      hasVideo: true,
      hasAudio: true,
    })

    const watchAck = await emitAck<{
      ok: true
      data: { stream: { id: string }; streamerSocketId: string }
    }>(guest, 'watch:start', {
      roomId: created.room.id,
      streamSessionId: startAck.data.stream.id,
    })
    const stopAck = await emitAck<{ ok: true }>(guest, 'watch:stop', {
      roomId: created.room.id,
      streamSessionId: startAck.data.stream.id,
    })
    const inactiveAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'watch:start',
      { roomId: created.room.id, streamSessionId: created.room.id },
    )

    expect(notInRoomAck).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' })
    expect(watchAck).toMatchObject({
      ok: true,
      data: {
        stream: { id: startAck.data.stream.id },
        streamerSocketId: host.id,
      },
    })
    await expect(streamStartedSeen).resolves.toMatchObject({
      room: { id: created.room.id },
      stream: { id: startAck.data.stream.id },
    })
    expect(stopAck).toMatchObject({ ok: true })
    expect(inactiveAck).toMatchObject({
      ok: false,
      code: 'STREAM_NOT_ACTIVE',
    })

    host.close()
    guest.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('accepts socket thumbnails and broadcasts updates', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const host = await makeClient(port, hostId)
    const guest = await makeClient(port, guestId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'thumbnail socket room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })
    await emitAck<{ ok: true }>(guest, 'room:join', { roomId: created.room.id })
    const startAck = await emitAck<{
      ok: true
      data: { stream: { id: string } }
    }>(host, 'stream:start', {
      roomId: created.room.id,
      hasVideo: true,
      hasAudio: true,
    })
    const updateSeen = new Promise((resolve) =>
      guest.once('stream:thumbnailUpdated', resolve),
    )

    const thumbnailAck = await emitAck<{
      ok: true
      data: { thumbnailUpdatedAt: string }
    }>(host, 'stream:thumbnail', {
      roomId: created.room.id,
      streamSessionId: startAck.data.stream.id,
      contentType: 'image/webp',
      byteLength: 9,
      data: Buffer.from('thumbnail'),
    })
    const forbiddenAck = await emitAck<{ ok: false; code: string }>(
      guest,
      'stream:thumbnail',
      {
        roomId: created.room.id,
        streamSessionId: startAck.data.stream.id,
        contentType: 'image/webp',
        byteLength: 5,
        data: Buffer.from('guest'),
      },
    )
    const tooLargeAck = await emitAck<{ ok: false; code: string }>(
      host,
      'stream:thumbnail',
      {
        roomId: created.room.id,
        streamSessionId: startAck.data.stream.id,
        contentType: 'image/webp',
        byteLength: 102_401,
        data: Buffer.alloc(102_401),
      },
    )

    expect(thumbnailAck.ok).toBe(true)
    expect(typeof thumbnailAck.data.thumbnailUpdatedAt).toBe('string')
    await expect(updateSeen).resolves.toMatchObject({
      streamSessionId: startAck.data.stream.id,
    })
    expect(forbiddenAck).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(tooLargeAck).toMatchObject({
      ok: false,
      code: 'THUMBNAIL_TOO_LARGE',
    })

    host.close()
    guest.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('returns documented stream ban code from stream start', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const host = await makeClient(port, hostId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'sanctioned stream room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await createSanction({
      userId: hostId,
      type: 'stream_ban',
      reason: 'abuse',
      createdByUserId: hostId,
    })
    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })

    const ack = await emitAck<{ ok: false; code: string }>(
      host,
      'stream:start',
      {
        roomId: created.room.id,
        hasVideo: true,
        hasAudio: true,
      },
    )

    expect(ack).toMatchObject({ ok: false, code: 'STREAM_BANNED' })

    host.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('allows platform admins to lift sanctions over socket', async () => {
    const previousAllowlist = process.env.ADMIN_DISCORD_IDS
    process.env.ADMIN_DISCORD_IDS = 'discord-admin'
    await db.insert(account).values({
      id: 'socket-admin-account',
      accountId: 'discord-admin',
      providerId: 'discord',
      userId: adminId,
    })

    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const admin = await makeClient(port, adminId)
    const guest = await makeClient(port, guestId)
    const sanction = await createSanction({
      userId: guestId,
      type: 'chat_ban',
      reason: 'abuse',
      createdByUserId: adminId,
    })
    const liftedSeen = new Promise<{ sanction: { id: string } }>((resolve) => {
      guest.once('sanction:lifted', resolve)
    })

    try {
      const ack = await emitAck<{
        ok: true
        data: { sanction: { id: string; liftedByUserId: string } }
      }>(admin, 'admin:liftSanction', { sanctionId: sanction.id })

      expect(ack).toMatchObject({
        ok: true,
        data: {
          sanction: { id: sanction.id, liftedByUserId: adminId },
        },
      })
      await expect(liftedSeen).resolves.toMatchObject({
        sanction: { id: sanction.id },
      })
      await expect(
        emitAck<{ ok: false; code: string }>(admin, 'admin:liftSanction', {
          sanctionId: sanction.id,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'CONFLICT' })
    } finally {
      process.env.ADMIN_DISCORD_IDS = previousAllowlist
      admin.close()
      guest.close()
      await new Promise<void>((resolve) => io.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })

  test('rejects stream starts from unsupported browsers', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) => socket.handshake.auth.userId as string,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    const host = await makeClient(port, hostId, 'Mozilla/5.0 Firefox/120')
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'unsupported browser room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await emitAck<{ ok: true }>(host, 'room:join', { roomId: created.room.id })

    const ack = await emitAck<{ ok: false; code: string }>(
      host,
      'stream:start',
      { roomId: created.room.id, hasVideo: true, hasAudio: true },
    )

    expect(ack).toMatchObject({ ok: false, code: 'UNSUPPORTED_BROWSER' })

    host.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })

  test('counts distinct connected users by anonymous visitor id', async () => {
    const httpServer = createServer()
    const io = new Server(httpServer)
    registerRealtime(io, {
      resolveUserId: (socket) =>
        (socket.handshake.auth.userId as string | undefined) ?? null,
    })
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const firstTab = createClient(`http://localhost:${port}`, {
      auth: { visitorId: 'browser-a' },
      forceNew: true,
      transports: ['websocket'],
    })
    const secondTab = createClient(`http://localhost:${port}`, {
      auth: { visitorId: 'browser-a' },
      forceNew: true,
      transports: ['websocket'],
    })
    const otherBrowser = createClient(`http://localhost:${port}`, {
      auth: { visitorId: 'browser-b' },
      forceNew: true,
      transports: ['websocket'],
    })

    try {
      const counts: number[] = []
      for (const socket of [firstTab, secondTab, otherBrowser]) {
        socket.on('site:presence', (event: { connectedUsers: number }) => {
          counts.push(event.connectedUsers)
        })
      }

      await Promise.all(
        [firstTab, secondTab, otherBrowser].map(
          (socket) =>
            new Promise<void>((resolve, reject) => {
              socket.once('connect', resolve)
              socket.once('connect_error', reject)
            }),
        ),
      )

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(counts).toContain(1)
      expect(counts).toContain(2)
      expect(counts).not.toContain(3)
    } finally {
      firstTab.close()
      secondTab.close()
      otherBrowser.close()
      await new Promise<void>((resolve) => io.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })
})
