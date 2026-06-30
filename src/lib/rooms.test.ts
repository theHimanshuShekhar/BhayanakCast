import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '#/db'
import {
  account,
  chatMessages,
  platformSanctions,
  roomMemberships,
  rooms,
  streamSessions,
  user,
} from '#/db/schema'
import { banRoomMember, createSanction } from './moderation'
import {
  createRoom,
  expireEmptyGraceRooms,
  joinRoom,
  leaveRoom,
  loadRoomTranscript,
  RoomServiceError,
} from './rooms'
import { startStream } from './streams'

const hostId = 'host-user'
const guestId = 'guest-user'
const adminId = 'admin-user'

async function seedUser(id: string) {
  await db
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
    })
    .onConflictDoNothing()
}

async function clean() {
  await db.delete(account)
  await db.delete(streamSessions)
  await db.delete(platformSanctions)
  await db.delete(chatMessages)
  await db.delete(roomMemberships)
  await db.delete(rooms)
  await db.delete(user)
}

beforeEach(async () => {
  await clean()
  await seedUser(hostId)
  await seedUser(guestId)
})

afterEach(async () => {
  await clean()
})

describe('room service', () => {
  test('creates a public room and admits the host', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'CS with Pako',
        category: 'gaming',
        tags: ['cs2'],
        visibility: 'public',
      },
    })

    expect(created.room.currentHostUserId).toBe(hostId)
    expect(created.room.visibility).toBe('public')
    expect(created.room.tags).toEqual(['cs2'])
    expect(created.membership.userId).toBe(hostId)
  })

  test('requires the shared password for private room join', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'lo-fi jam sesh',
        category: 'music',
        tags: [],
        visibility: 'private',
        password: 'secret-room',
      },
    })

    await expect(
      joinRoom({ userId: guestId, roomId: created.room.id, password: 'wrong' }),
    ).rejects.toMatchObject(new RoomServiceError('INVALID_PASSWORD'))

    const joined = await joinRoom({
      userId: guestId,
      roomId: created.room.id,
      password: 'secret-room',
    })

    expect(joined.membership.userId).toBe(guestId)
  })

  test('blocks sanctioned room creation', async () => {
    await createSanction({
      userId: hostId,
      type: 'room_creation_ban',
      reason: 'abuse',
      createdByUserId: hostId,
    })

    await expect(
      createRoom({
        userId: hostId,
        input: {
          name: 'blocked room',
          category: 'test',
          tags: [],
          visibility: 'public',
        },
      }),
    ).rejects.toMatchObject({ code: 'ROOM_CREATION_BANNED' })
  })

  test('uses documented join error code for missing rooms', async () => {
    await expect(
      joinRoom({ userId: guestId, roomId: randomUUID() }),
    ).rejects.toMatchObject(new RoomServiceError('NOT_FOUND'))
  })

  test('hands off host and marks empty rooms with grace on leave', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'lifecycle room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await joinRoom({ userId: guestId, roomId: created.room.id })

    const hostLeft = await leaveRoom({
      userId: hostId,
      roomId: created.room.id,
    })
    expect(hostLeft.room.currentHostUserId).toBe(guestId)
    expect(hostLeft.room.state).toBe('live')

    const empty = await leaveRoom({ userId: guestId, roomId: created.room.id })
    expect(empty.room.state).toBe('empty_grace')
    expect(empty.room.emptySince).toBeInstanceOf(Date)
  })

  test('revives empty grace rooms for the next joiner', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'revive room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await leaveRoom({ userId: hostId, roomId: created.room.id })

    const joined = await joinRoom({ userId: guestId, roomId: created.room.id })

    expect(joined.room.state).toBe('live')
    expect(joined.room.currentHostUserId).toBe(guestId)
    expect(joined.room.emptySince).toBeNull()
  })

  test('expires empty grace rooms after five minutes', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'expire room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await leaveRoom({ userId: hostId, roomId: created.room.id })

    const expired = await expireEmptyGraceRooms(
      new Date(Date.now() + 5 * 60 * 1000 + 1),
    )
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, created.room.id))
      .limit(1)

    expect(expired.map((item) => item.id)).toContain(created.room.id)
    expect(room.state).toBe('ended')
    expect(room.endedAt).toBeInstanceOf(Date)
  })

  test('join returns members active streams and recent messages snapshot', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'snapshot room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    const stream = await startStream({
      roomId: created.room.id,
      userId: hostId,
      hasVideo: true,
      hasAudio: true,
    })
    await db.insert(chatMessages).values({
      roomId: created.room.id,
      userId: hostId,
      body: 'before join',
    })

    const joined = await joinRoom({ userId: guestId, roomId: created.room.id })

    expect(joined.members.map((member) => member.userId).sort()).toEqual([
      guestId,
      hostId,
    ])
    expect(joined.members.map((member) => member.user.name).sort()).toEqual([
      guestId,
      hostId,
    ])
    expect(joined.streams.map((row) => row.user.name)).toEqual([hostId])
    expect(joined.streams.map((row) => row.id)).toEqual([stream.id])
    expect(joined.recentMessages.map((message) => message.body)).toEqual([
      'before join',
    ])
  })

  test('keeps room capacity hard under concurrent joins', async () => {
    const fillUserIds = Array.from({ length: 8 }, (_, index) => `fill-${index}`)
    const racerIds = ['racer-a', 'racer-b']
    for (const userId of [...fillUserIds, ...racerIds]) {
      await seedUser(userId)
    }
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'capacity room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await db
      .insert(roomMemberships)
      .values(
        fillUserIds.map((userId) => ({ roomId: created.room.id, userId })),
      )

    const results = await Promise.allSettled(
      racerIds.map((userId) => joinRoom({ userId, roomId: created.room.id })),
    )
    const activeMemberships = await db
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.roomId, created.room.id))

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof RoomServiceError &&
          result.reason.code === 'ROOM_FULL',
      ),
    ).toHaveLength(1)
    expect(activeMemberships).toHaveLength(10)
  })

  test('enforces documented join gate ordering', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'gate room',
        category: 'test',
        tags: [],
        visibility: 'private',
        password: 'secret',
      },
    })

    await createSanction({
      userId: guestId,
      type: 'full_suspension',
      reason: 'blocked',
      createdByUserId: hostId,
    })
    await expect(
      joinRoom({ userId: guestId, roomId: randomUUID() }),
    ).rejects.toMatchObject(new RoomServiceError('FULLY_SUSPENDED'))

    await seedUser('gate-banned')
    await banRoomMember({
      roomId: created.room.id,
      targetUserId: 'gate-banned',
      bannedByUserId: hostId,
    })
    await expect(
      joinRoom({ userId: 'gate-banned', roomId: created.room.id }),
    ).rejects.toMatchObject(new RoomServiceError('ROOM_BANNED'))
  })

  test('loads ended room transcripts for host and platform admins only', async () => {
    await seedUser(adminId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'transcript room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await db.insert(account).values({
      id: 'admin-account',
      accountId: 'discord-admin',
      providerId: 'discord',
      userId: adminId,
      password: null,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(chatMessages).values([
      { roomId: created.room.id, userId: hostId, body: 'first message' },
      { roomId: created.room.id, userId: guestId, body: 'second message' },
    ])
    await db
      .update(rooms)
      .set({ state: 'ended', endedAt: new Date() })
      .where(eq(rooms.id, created.room.id))

    const hostTranscript = await loadRoomTranscript({
      roomId: created.room.id,
      userId: hostId,
      adminDiscordIds: ['discord-admin'],
    })
    const adminTranscript = await loadRoomTranscript({
      roomId: created.room.id,
      userId: adminId,
      adminDiscordIds: ['discord-admin'],
    })

    expect(hostTranscript.messages.map((message) => message.body)).toEqual([
      'first message',
      'second message',
    ])
    expect(adminTranscript.messages).toHaveLength(2)
    await expect(
      loadRoomTranscript({
        roomId: created.room.id,
        userId: guestId,
        adminDiscordIds: ['discord-admin'],
      }),
    ).rejects.toMatchObject(new RoomServiceError('FORBIDDEN'))
  })
})
