import { eq } from 'drizzle-orm'
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
import { createRoom } from './rooms'
import { createSanction } from './moderation'
import { createMemoryRateLimitStore } from './rate-limit'
import {
  canStartStreamFromUserAgent,
  getThumbnail,
  startStream,
  stopStream,
  storeThumbnail,
} from './streams'

const hostId = 'stream-host'
const guestId = 'stream-guest'

async function clean() {
  await db.delete(streamSessions)
  await db.delete(platformSanctions)
  await db.delete(reports)
  await db.delete(roomBans)
  await db.delete(chatMessages)
  await db.delete(roomMemberships)
  await db.delete(rooms)
  await db.delete(user)
}

beforeEach(async () => {
  await clean()
  await db.insert(user).values([
    {
      id: hostId,
      name: hostId,
      email: `${hostId}@example.test`,
      emailVerified: true,
    },
    {
      id: guestId,
      name: guestId,
      email: `${guestId}@example.test`,
      emailVerified: true,
    },
  ])
})

afterEach(async () => {
  await clean()
})

describe('streams', () => {
  test('starts and stops stream sessions', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'stream room',
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
      displaySurface: 'window',
      label: 'Ableton Live',
    })

    expect(stream.endedAt).toBeNull()
    const stopped = await stopStream({
      streamSessionId: stream.id,
      roomId: created.room.id,
      userId: hostId,
      reason: 'self',
    })
    expect(stopped.stopReason).toBe('self')
    expect(stopped.endedAt).toBeInstanceOf(Date)
  })

  test('blocks self-stop for another user stream', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'protected stream room',
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

    await expect(
      stopStream({
        streamSessionId: stream.id,
        roomId: created.room.id,
        userId: guestId,
        reason: 'self',
      }),
    ).rejects.toMatchObject({ code: 'STREAM_NOT_ACTIVE' })
  })

  test('stores active owned thumbnails with abuse controls', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'thumbnail room',
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
    const bytes = Buffer.from('thumbnail')
    const now = new Date('2026-01-01T00:00:00.000Z')
    const rateLimitStore = createMemoryRateLimitStore(() => now.getTime())

    await storeThumbnail({
      streamSessionId: stream.id,
      roomId: created.room.id,
      userId: hostId,
      thumbnail: { contentType: 'image/webp', bytes },
      now,
      rateLimitStore,
    })
    const [updated] = await db
      .select()
      .from(streamSessions)
      .where(eq(streamSessions.id, stream.id))

    expect(updated.thumbnailUpdatedAt).toEqual(now)
    expect(getThumbnail(stream.id)).toEqual({
      contentType: 'image/webp',
      bytes,
    })
    await expect(
      storeThumbnail({
        streamSessionId: stream.id,
        roomId: created.room.id,
        userId: hostId,
        thumbnail: { contentType: 'image/webp', bytes: Buffer.from('again') },
        now: new Date('2026-01-01T00:00:10.000Z'),
        rateLimitStore,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(
      storeThumbnail({
        streamSessionId: stream.id,
        roomId: created.room.id,
        userId: hostId,
        thumbnail: { contentType: 'image/webp', bytes: Buffer.alloc(102_401) },
        now: new Date('2026-01-01T00:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'THUMBNAIL_TOO_LARGE' })
    await expect(
      storeThumbnail({
        streamSessionId: stream.id,
        roomId: created.room.id,
        userId: guestId,
        thumbnail: { contentType: 'image/webp', bytes: Buffer.from('guest') },
        now: new Date('2026-01-01T00:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await stopStream({
      streamSessionId: stream.id,
      roomId: created.room.id,
      userId: hostId,
      reason: 'self',
    })
    await expect(
      storeThumbnail({
        streamSessionId: stream.id,
        roomId: created.room.id,
        userId: hostId,
        thumbnail: { contentType: 'image/webp', bytes },
        now: new Date('2026-01-01T00:04:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'STREAM_NOT_ACTIVE' })
  })

  test('blocks sanctioned stream starts', async () => {
    await createSanction({
      userId: hostId,
      type: 'stream_ban',
      reason: 'abuse',
      createdByUserId: hostId,
    })
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'sanction room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })

    await expect(
      startStream({
        roomId: created.room.id,
        userId: hostId,
        hasVideo: true,
        hasAudio: true,
      }),
    ).rejects.toMatchObject({ code: 'STREAM_BANNED' })
  })

  test('allows Chromium desktop to start streams', () => {
    expect(
      canStartStreamFromUserAgent('Mozilla/5.0 Chrome/120 Safari/537.36'),
    ).toBe(true)
    expect(canStartStreamFromUserAgent('Mozilla/5.0 Firefox/120')).toBe(false)
  })
})
