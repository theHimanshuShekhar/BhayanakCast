import { eq, or } from 'drizzle-orm'
import { db } from '#/db'
import {
  reports,
  roomMemberships,
  rooms,
  streamSessions,
  user,
  userDailyFacts,
  userPairDailyFacts,
} from '#/db/schema'

type DailyFact = typeof userDailyFacts.$inferInsert
type Membership = typeof roomMemberships.$inferSelect
type PairDailyFact = typeof userPairDailyFacts.$inferInsert & {
  secondsTogether: number
  roomsTogether: number
}

type ProfileTotals = {
  streamedSeconds: number
  watchedSeconds: number
  roomsHosted: number
  roomsJoined: number
  peakViewers: number
  reportsCreated: number
  reportsReceived: number
}

const zeroTotals = (): ProfileTotals => ({
  streamedSeconds: 0,
  watchedSeconds: 0,
  roomsHosted: 0,
  roomsJoined: 0,
  peakViewers: 0,
  reportsCreated: 0,
  reportsReceived: 0,
})

export async function recomputeDailyFacts(day: string) {
  const { dayStart, dayEnd } = dayBounds(day)
  const [users, roomRows, membershipRows, streamRows, reportRows] =
    await Promise.all([
      db.select().from(user),
      db.select().from(rooms),
      db.select().from(roomMemberships),
      db.select().from(streamSessions),
      db.select().from(reports),
    ])
  const byUser = new Map(
    users.map((row) => [
      row.id,
      { userId: row.id, day, ...zeroTotals() } satisfies DailyFact,
    ]),
  )

  for (const room of roomRows) {
    if (isOnDay(room.createdAt, day)) {
      byUser.get(room.createdByUserId)!.roomsHosted += 1
    }
  }
  for (const membership of membershipRows) {
    if (isOnDay(membership.joinedAt, day)) {
      byUser.get(membership.userId)!.roomsJoined += 1
    }
  }
  for (const stream of streamRows) {
    const streamedSeconds = secondsInWindow(
      stream.startedAt,
      stream.endedAt,
      dayStart,
      dayEnd,
    )
    if (streamedSeconds === 0) continue

    const streamOwnerFact = byUser.get(stream.userId)
    if (streamOwnerFact) streamOwnerFact.streamedSeconds += streamedSeconds

    const viewerIntervals: { start: Date; end: Date }[] = []
    for (const membership of membershipRows) {
      if (
        membership.roomId !== stream.roomId ||
        membership.userId === stream.userId
      ) {
        continue
      }
      const watchedInterval = overlappingInterval(
        membership.joinedAt,
        membership.leftAt,
        stream.startedAt,
        stream.endedAt,
        dayStart,
        dayEnd,
      )
      if (!watchedInterval) continue

      const viewerFact = byUser.get(membership.userId)
      if (viewerFact) {
        viewerFact.watchedSeconds += intervalSeconds(watchedInterval)
      }
      viewerIntervals.push(watchedInterval)
    }
    if (streamOwnerFact) {
      streamOwnerFact.peakViewers = Math.max(
        streamOwnerFact.peakViewers,
        peakConcurrentIntervals(viewerIntervals),
      )
    }
  }
  for (const report of reportRows) {
    if (!isOnDay(report.createdAt, day)) continue
    const reporterFact = byUser.get(report.reporterUserId)
    if (reporterFact) reporterFact.reportsCreated += 1
    if (report.targetType === 'account') {
      const targetFact = byUser.get(report.targetId)
      if (targetFact) targetFact.reportsReceived += 1
    }
  }

  await db.delete(userPairDailyFacts).where(eq(userPairDailyFacts.day, day))
  await db.delete(userDailyFacts).where(eq(userDailyFacts.day, day))

  const facts = [...byUser.values()]
  if (facts.length > 0) await db.insert(userDailyFacts).values(facts)

  const pairFacts = buildPairFacts(day, membershipRows)
  if (pairFacts.length > 0)
    await db.insert(userPairDailyFacts).values(pairFacts)

  return { userFacts: facts.length, pairFacts: pairFacts.length }
}

export async function getPublicProfile(userId: string) {
  const profileUsers = await db.select().from(user).where(eq(user.id, userId))
  if (profileUsers.length === 0) return null
  const [profileUser] = profileUsers

  const [facts, pairRows] = await Promise.all([
    db.select().from(userDailyFacts).where(eq(userDailyFacts.userId, userId)),
    db
      .select()
      .from(userPairDailyFacts)
      .where(
        or(
          eq(userPairDailyFacts.userAId, userId),
          eq(userPairDailyFacts.userBId, userId),
        ),
      ),
  ])

  const coUserIds = [
    ...new Set(
      pairRows.map((fact) =>
        fact.userAId === userId ? fact.userBId : fact.userAId,
      ),
    ),
  ]
  const coUsers = await db.select().from(user)
  const topCoUsers = coUserIds
    .map((coUserId) => {
      const totalsForUser = pairRows
        .filter(
          (fact) => fact.userAId === coUserId || fact.userBId === coUserId,
        )
        .reduce(
          (totalsForPair, fact) => ({
            secondsTogether:
              totalsForPair.secondsTogether + fact.secondsTogether,
            roomsTogether: totalsForPair.roomsTogether + fact.roomsTogether,
          }),
          { secondsTogether: 0, roomsTogether: 0 },
        )
      const coUser = coUsers.find((candidate) => candidate.id === coUserId)
      return {
        user: {
          id: coUserId,
          name: coUser?.name ?? coUserId,
          image: coUser?.image,
        },
        ...totalsForUser,
      }
    })
    .sort((left, right) => right.secondsTogether - left.secondsTogether)
    .slice(0, 5)
  const totals = zeroTotals()
  let lastUpdatedAt: Date | undefined
  for (const fact of facts) {
    totals.streamedSeconds += fact.streamedSeconds
    totals.watchedSeconds += fact.watchedSeconds
    totals.roomsHosted += fact.roomsHosted
    totals.roomsJoined += fact.roomsJoined
    totals.peakViewers = Math.max(totals.peakViewers, fact.peakViewers)
    totals.reportsCreated += fact.reportsCreated
    totals.reportsReceived += fact.reportsReceived
    if (!lastUpdatedAt || fact.computedAt > lastUpdatedAt) {
      lastUpdatedAt = fact.computedAt
    }
  }

  return {
    user: {
      id: profileUser.id,
      name: profileUser.name,
      image: profileUser.image,
    },
    facts: totals,
    topCoUsers,
    lastUpdatedAt,
  }
}

export async function getAdminMetrics() {
  const [users, roomRows, streamRows, reportRows, facts] = await Promise.all([
    db.select().from(user),
    db.select().from(rooms),
    db.select().from(streamSessions),
    db.select().from(reports),
    db.select().from(userDailyFacts),
  ])
  return {
    totalUsers: users.length,
    totalRooms: roomRows.length,
    liveRooms: roomRows.filter((room) => room.state === 'live').length,
    activeStreams: streamRows.filter((stream) => !stream.endedAt).length,
    openReports: reportRows.filter((report) => !report.resolvedAt).length,
    lastUpdatedAt: newestComputedAt(facts),
  }
}

function buildPairFacts(day: string, membershipRows: Membership[]) {
  const { dayStart, dayEnd } = dayBounds(day)
  const pairs = new Map<string, PairDailyFact>()
  const countedRooms = new Map<string, Set<string>>()
  const byRoom = new Map<string, Membership[]>()
  for (const membership of membershipRows) {
    if (
      secondsInWindow(
        membership.joinedAt,
        membership.leftAt,
        dayStart,
        dayEnd,
      ) === 0
    ) {
      continue
    }
    const memberships = byRoom.get(membership.roomId) ?? []
    memberships.push(membership)
    byRoom.set(membership.roomId, memberships)
  }

  for (const [roomId, memberships] of byRoom) {
    for (let i = 0; i < memberships.length; i += 1) {
      for (let j = i + 1; j < memberships.length; j += 1) {
        const secondsTogether = overlappingSeconds(
          memberships[i].joinedAt,
          memberships[i].leftAt,
          memberships[j].joinedAt,
          memberships[j].leftAt,
          dayStart,
          dayEnd,
        )
        if (secondsTogether === 0) continue

        const [userAId, userBId] = [
          memberships[i].userId,
          memberships[j].userId,
        ].sort()
        const key = `${userAId}:${userBId}`
        const fact = pairs.get(key) ?? {
          userAId,
          userBId,
          day,
          secondsTogether: 0,
          roomsTogether: 0,
        }
        fact.secondsTogether += secondsTogether
        const roomsForPair = countedRooms.get(key) ?? new Set<string>()
        if (!roomsForPair.has(roomId)) {
          fact.roomsTogether += 1
          roomsForPair.add(roomId)
          countedRooms.set(key, roomsForPair)
        }
        pairs.set(key, fact)
      }
    }
  }

  return [...pairs.values()]
}

function dayBounds(day: string) {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)
  return { dayStart, dayEnd }
}

function isOnDay(date: Date, day: string) {
  return date.toISOString().slice(0, 10) === day
}

function peakConcurrentIntervals(intervals: { start: Date; end: Date }[]) {
  const events = intervals.flatMap((interval) => [
    { at: interval.start, delta: 1 },
    { at: interval.end, delta: -1 },
  ])
  events.sort((left, right) => {
    const timeDelta = left.at.getTime() - right.at.getTime()
    return timeDelta === 0 ? left.delta - right.delta : timeDelta
  })

  let active = 0
  let peak = 0
  for (const event of events) {
    active += event.delta
    peak = Math.max(peak, active)
  }
  return peak
}

function overlappingInterval(
  leftStart: Date,
  leftEnd: Date | null,
  rightStart: Date,
  rightEnd: Date | null,
  windowStart: Date,
  windowEnd: Date,
) {
  const start = maxDate(maxDate(leftStart, rightStart), windowStart)
  const end = minDate(minDate(leftEnd, rightEnd), windowEnd) ?? windowEnd
  return end > start ? { start, end } : null
}

function intervalSeconds(interval: { start: Date; end: Date }) {
  return Math.floor((interval.end.getTime() - interval.start.getTime()) / 1000)
}

function overlappingSeconds(
  leftStart: Date,
  leftEnd: Date | null,
  rightStart: Date,
  rightEnd: Date | null,
  windowStart: Date,
  windowEnd: Date,
) {
  return secondsInWindow(
    maxDate(leftStart, rightStart),
    minDate(leftEnd, rightEnd),
    windowStart,
    windowEnd,
  )
}

function secondsInWindow(
  start: Date,
  end: Date | null,
  windowStart: Date,
  windowEnd: Date,
) {
  const overlapStart = maxDate(start, windowStart)
  const overlapEnd = minDate(end, windowEnd) ?? windowEnd
  return Math.max(
    0,
    Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 1000),
  )
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right
}

function minDate(left: Date | null, right: Date | null) {
  if (!left) return right
  if (!right) return left
  return left < right ? left : right
}

function newestComputedAt(facts: (typeof userDailyFacts.$inferSelect)[]) {
  return facts.reduce<Date | undefined>(
    (newest, fact) =>
      !newest || fact.computedAt > newest ? fact.computedAt : newest,
    undefined,
  )
}
