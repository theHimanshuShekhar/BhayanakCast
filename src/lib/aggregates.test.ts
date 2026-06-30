import { desc, eq } from 'drizzle-orm'
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
  userDailyFacts,
  userPairDailyFacts,
} from '#/db/schema'
import {
  recomputeDailyFacts,
  getAdminMetrics,
  getPublicProfile,
} from './aggregates'
import { createReport } from './moderation'
import { createRoom } from './rooms'
import { startStream, stopStream } from './streams'

const day = new Date().toISOString().slice(0, 10)
const hostId = 'aggregate-host'
const guestId = 'aggregate-guest'

async function clean() {
  await db.delete(userPairDailyFacts)
  await db.delete(userDailyFacts)
  await db.delete(streamSessions)
  await db.delete(platformSanctions)
  await db.delete(reports)
  await db.delete(roomBans)
  await db.delete(chatMessages)
  await db.delete(roomMemberships)
  await db.delete(rooms)
  await db.delete(user)
}

async function seedUser(id: string) {
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test`, emailVerified: true })
}

beforeEach(async () => {
  await clean()
  await seedUser(hostId)
  await seedUser(guestId)
})

afterEach(async () => {
  await clean()
})

describe('aggregate facts', () => {
  test('recomputes user and pair facts for a day', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'aggregate room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await db
      .insert(roomMemberships)
      .values({ roomId: created.room.id, userId: guestId })
    const stream = await startStream({
      roomId: created.room.id,
      userId: hostId,
      hasVideo: true,
      hasAudio: true,
    })
    await stopStream({
      streamSessionId: stream.id,
      roomId: created.room.id,
      userId: hostId,
      reason: 'self',
    })
    await createReport({
      reporterUserId: guestId,
      targetType: 'account',
      targetId: hostId,
      roomId: created.room.id,
      reason: 'spam',
    })

    await recomputeDailyFacts(day)

    const [hostFact] = await db
      .select()
      .from(userDailyFacts)
      .where(eq(userDailyFacts.userId, hostId))
    const [guestFact] = await db
      .select()
      .from(userDailyFacts)
      .where(eq(userDailyFacts.userId, guestId))
    const [pairFact] = await db.select().from(userPairDailyFacts)
    const [firstUserId, secondUserId] = [hostId, guestId].sort()

    expect(hostFact.roomsHosted).toBe(1)
    expect(hostFact.roomsJoined).toBe(1)
    expect(hostFact.streamedSeconds).toBeGreaterThanOrEqual(0)
    expect(hostFact.reportsReceived).toBe(1)
    expect(guestFact.roomsJoined).toBe(1)
    expect(guestFact.reportsCreated).toBe(1)
    expect(pairFact.userAId).toBe(firstUserId)
    expect(pairFact.userBId).toBe(secondUserId)
    expect(pairFact.roomsTogether).toBe(1)
  })

  test('returns public profile and admin metrics with freshness timestamp', async () => {
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'profile room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await db
      .insert(roomMemberships)
      .values({ roomId: created.room.id, userId: guestId })
    await recomputeDailyFacts(day)

    const profile = await getPublicProfile(hostId)
    const metrics = await getAdminMetrics()
    const latestFact = await db
      .select()
      .from(userDailyFacts)
      .orderBy(desc(userDailyFacts.computedAt))
      .limit(1)

    expect(profile?.user.id).toBe(hostId)
    expect(profile?.facts.roomsHosted).toBe(1)
    expect(profile?.facts.roomsJoined).toBe(1)
    expect(profile?.lastUpdatedAt?.getTime()).toBe(
      latestFact[0].computedAt.getTime(),
    )
    expect(profile?.topCoUsers).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ id: guestId }),
        roomsTogether: 1,
      }),
    ])
    expect(metrics.totalUsers).toBe(2)
    expect(metrics.liveRooms).toBe(1)
    expect(metrics.lastUpdatedAt?.getTime()).toBe(
      latestFact[0].computedAt.getTime(),
    )
  })

  test('clips streams watches and co-user facts to the recomputed day', async () => {
    const targetDay = '2024-03-10'
    const lateGuestId = 'aggregate-late-guest'
    await seedUser(lateGuestId)
    const created = await createRoom({
      userId: hostId,
      input: {
        name: 'overnight room',
        category: 'test',
        tags: [],
        visibility: 'public',
      },
    })
    await db
      .update(roomMemberships)
      .set({
        joinedAt: new Date('2024-03-09T23:50:00.000Z'),
        leftAt: new Date('2024-03-10T00:10:00.000Z'),
      })
      .where(eq(roomMemberships.userId, hostId))
    await db.insert(roomMemberships).values([
      {
        roomId: created.room.id,
        userId: guestId,
        joinedAt: new Date('2024-03-10T00:05:00.000Z'),
        leftAt: new Date('2024-03-10T00:15:00.000Z'),
      },
      {
        roomId: created.room.id,
        userId: lateGuestId,
        joinedAt: new Date('2024-03-10T00:20:00.000Z'),
        leftAt: new Date('2024-03-10T00:30:00.000Z'),
      },
    ])
    await db.insert(streamSessions).values({
      roomId: created.room.id,
      userId: hostId,
      startedAt: new Date('2024-03-09T23:55:00.000Z'),
      endedAt: null,
      hasVideo: true,
      hasAudio: true,
    })

    await recomputeDailyFacts(targetDay)

    const [hostFact] = await db
      .select()
      .from(userDailyFacts)
      .where(eq(userDailyFacts.userId, hostId))
    const [guestFact] = await db
      .select()
      .from(userDailyFacts)
      .where(eq(userDailyFacts.userId, guestId))
    const pairFacts = await db.select().from(userPairDailyFacts)
    const [firstUserId, secondUserId] = [hostId, guestId].sort()

    expect(hostFact.streamedSeconds).toBe(86_400)
    expect(hostFact.peakViewers).toBe(1)
    expect(guestFact.watchedSeconds).toBe(600)
    expect(pairFacts).toContainEqual(
      expect.objectContaining({
        userAId: firstUserId,
        userBId: secondUserId,
        roomsTogether: 1,
        secondsTogether: 300,
      }),
    )
    expect(pairFacts).not.toContainEqual(
      expect.objectContaining({
        userAId: expect.stringMatching(lateGuestId),
        userBId: expect.stringMatching(hostId),
      }),
    )
  })
})
