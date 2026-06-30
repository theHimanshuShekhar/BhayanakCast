import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '#/db'
import {
  chatMessages,
  platformSanctions,
  reports,
  roomBans,
  roomMemberships,
  rooms,
  streamSessions,
  user,
} from '#/db/schema'
import { createRoom, joinRoom } from './rooms'
import {
  banRoomMember,
  clearRoomBan,
  createReport,
  createSanction,
  hasEffectiveSanction,
  loadReportThumbnail,
  liftSanction,
} from './moderation'
import {
  createMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from './rate-limit'
import { startStream, storeThumbnail } from './streams'

const hostId = 'mod-host'
const guestId = 'mod-guest'
const adminId = 'mod-admin'

async function seedUser(id: string) {
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test`, emailVerified: true })
    .onConflictDoNothing()
}

async function clean() {
  await db.delete(platformSanctions)
  await db.delete(streamSessions)
  await db.delete(reports)
  await db.delete(roomBans)
  await db.delete(chatMessages)
  await db.delete(roomMemberships)
  await db.delete(rooms)
  await db.delete(user)
}

beforeEach(async () => {
  await clean()
  await seedUser(hostId)
  await seedUser(guestId)
  await seedUser(adminId)
  setRateLimitStoreForTests(createMemoryRateLimitStore())
})

afterEach(async () => {
  await clean()
  setRateLimitStoreForTests(undefined)
})

describe('moderation', () => {
  test('room bans block rejoin until cleared', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'mod room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await joinRoom({ userId: guestId, roomId: created.room.id })

    await banRoomMember({
      roomId: created.room.id,
      targetUserId: guestId,
      bannedByUserId: hostId,
    })

    await expect(
      joinRoom({ userId: guestId, roomId: created.room.id }),
    ).rejects.toMatchObject({
      code: 'ROOM_BANNED',
    })

    await clearRoomBan({
      roomId: created.room.id,
      targetUserId: guestId,
      clearedByUserId: hostId,
    })

    await expect(
      joinRoom({ userId: guestId, roomId: created.room.id }),
    ).resolves.toBeTruthy()
  })

  test('platform sanctions can block specific actions', async () => {
    await createSanction({
      userId: guestId,
      type: 'chat_ban',
      reason: 'spam',
      createdByUserId: adminId,
    })

    await expect(hasEffectiveSanction(guestId, 'chat_ban')).resolves.toBe(true)
    await expect(hasEffectiveSanction(guestId, 'stream_ban')).resolves.toBe(
      false,
    )
  })

  test('respects future starts and lifted sanctions', async () => {
    const future = await createSanction({
      userId: guestId,
      type: 'stream_ban',
      reason: 'future',
      createdByUserId: adminId,
      startsAt: new Date(Date.now() + 60_000),
    })
    await expect(hasEffectiveSanction(guestId, 'stream_ban')).resolves.toBe(
      false,
    )

    const active = await createSanction({
      userId: guestId,
      type: 'stream_ban',
      reason: 'active',
      createdByUserId: adminId,
    })
    await expect(hasEffectiveSanction(guestId, 'stream_ban')).resolves.toBe(
      true,
    )

    const lifted = await liftSanction({
      sanctionId: active.id,
      liftedByUserId: adminId,
    })

    expect(lifted.liftedByUserId).toBe(adminId)
    expect(lifted.liftedAt).toBeInstanceOf(Date)
    await expect(hasEffectiveSanction(guestId, 'stream_ban')).resolves.toBe(
      false,
    )
    await expect(
      liftSanction({ sanctionId: active.id, liftedByUserId: adminId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      liftSanction({ sanctionId: future.id, liftedByUserId: adminId }),
    ).resolves.toMatchObject({ liftedByUserId: adminId })
  })

  test('creates room-scoped reports', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'report room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })

    const report = await createReport({
      reporterUserId: guestId,
      targetType: 'room',
      targetId: created.room.id,
      roomId: created.room.id,
      reason: 'bad room',
    })

    expect(report.targetType).toBe('room')
    expect(report.roomId).toBe(created.room.id)
  })

  test('rejects reports for missing targets', async () => {
    await expect(
      createReport({
        reporterUserId: guestId,
        targetType: 'room',
        targetId: '00000000-0000-0000-0000-000000000000',
        reason: 'ghost room',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test('freezes latest stream thumbnail on stream reports', async () => {
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
      hasAudio: false,
    })
    const bytes = Buffer.from('blurred thumbnail')

    await storeThumbnail({
      streamSessionId: stream.id,
      roomId: created.room.id,
      userId: hostId,
      thumbnail: { contentType: 'image/webp', bytes },
    })

    const report = await createReport({
      reporterUserId: guestId,
      targetType: 'stream_session',
      targetId: stream.id,
      reason: 'unsafe stream',
    })

    expect(report.roomId).toBe(created.room.id)
    expect(report.thumbnailContentType).toBe('image/webp')
    expect(Buffer.from(report.thumbnailSnapshot ?? [])).toEqual(bytes)
    await expect(loadReportThumbnail(report.id)).resolves.toMatchObject({
      contentType: 'image/webp',
      bytes,
    })
  })
})
