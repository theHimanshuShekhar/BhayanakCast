import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import {
  RoomService,
  type CreateRoomResult,
  type RoomModerationAuditEntry,
} from '../../src/server/rooms/room-service'
import { StreamService } from '../../src/server/streams/stream-service'
import { SubscriptionService } from '../../src/server/streams/subscription-service'
import { getIntegrationContext } from '../setup/integration'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()))
})

async function fixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `admin-room-termination-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  cleanup.push(async () => {
    await Promise.all([pool.end(), valkey.quit()])
  })

  const instant = new Date('2026-08-01T12:00:00.000Z')
  const roomEvents: unknown[] = []
  const homeEvents: unknown[] = []
  const audit: RoomModerationAuditEntry[] = []
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}admin-room-termination:`,
    now: () => instant,
    revokeConnections: () => undefined,
    publishRoomEvent: (event) => roomEvents.push(event),
    publishHomeEvent: (event) => homeEvents.push(event),
    moderationAudit: (entry) => audit.push(entry),
  })
  const streams = new StreamService({ pool, now: () => instant })
  const subscriptions = new SubscriptionService(pool, () => instant)

  async function account(name: string) {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, $4)`,
      [id, name, `${id}@example.test`, instant],
    )
    return id
  }

  return { pool, rooms, streams, subscriptions, roomEvents, homeEvents, audit, account, instant }
}

function created(result: CreateRoomResult) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error('Expected created room')
  return result
}

describe('Platform Admin room termination', () => {
  test('denies a Host while an Admin atomically ends every live resource without grace', async () => {
    const value = await fixture()
    const hostId = await value.account('Host')
    const memberId = await value.account('Member')
    const adminId = await value.account('Admin')
    const room = created(await value.rooms.createRoom(hostId, { name: 'Populated room' }))
    const joined = await value.rooms.admit(memberId, room.room.id)
    expect(joined.status).toBe('joined')
    if (joined.status !== 'joined') throw new Error('Expected joined member')

    const hostStream = await value.streams.start(hostId, room.room.id)
    const memberStream = await value.streams.start(memberId, room.room.id)
    expect(hostStream.status).toBe('started')
    expect(memberStream.status).toBe('started')
    if (hostStream.status !== 'started' || memberStream.status !== 'started') {
      throw new Error('Expected active Streams')
    }
    expect(
      (await value.subscriptions.subscribe(joined.membership.id, hostStream.streamId)).status,
    ).toBe('subscribed')
    expect(
      (await value.subscriptions.subscribe(room.membership.id, memberStream.streamId)).status,
    ).toBe('subscribed')

    await value.pool.query(
      `UPDATE room_membership
          SET reconnect_until = $2
        WHERE id = $1`,
      [joined.membership.id, new Date(value.instant.getTime() + 45_000)],
    )

    await expect(
      value.rooms.adminEndRoom(
        { accountId: hostId, isPlatformAdmin: false },
        room.room.id,
      ),
    ).resolves.toEqual({ status: 'forbidden' })
    await expect(
      value.pool.query<{ endedAt: Date | null }>(
        'SELECT ended_at AS "endedAt" FROM room WHERE id = $1',
        [room.room.id],
      ),
    ).resolves.toMatchObject({ rows: [{ endedAt: null }] })

    const result = await value.rooms.adminEndRoom(
      { accountId: adminId, isPlatformAdmin: true },
      room.room.id,
    )
    expect(result).toEqual({ status: 'ended', endedAt: value.instant })

    const state = await value.pool.query<{
      endedAt: Date | null
      emptyAt: Date | null
      activeMemberships: number
      activeStreams: number
      activeSubscriptions: number
      reconnectReservations: number
    }>(
      `SELECT room.ended_at AS "endedAt",
              room.empty_at AS "emptyAt",
              (SELECT count(*)::int FROM room_membership WHERE room_id = room.id AND left_at IS NULL) AS "activeMemberships",
              (SELECT count(*)::int FROM room_membership WHERE room_id = room.id AND reconnect_until IS NOT NULL) AS "reconnectReservations",
              (SELECT count(*)::int FROM stream WHERE room_id = room.id AND ended_at IS NULL) AS "activeStreams",
              (SELECT count(*)::int
                 FROM stream_subscription subscription
                 JOIN stream ON stream.id = subscription.stream_id
                WHERE stream.room_id = room.id AND subscription.ended_at IS NULL) AS "activeSubscriptions"
         FROM room
        WHERE room.id = $1`,
      [room.room.id],
    )
    expect(state.rows[0]).toEqual({
      endedAt: value.instant,
      emptyAt: null,
      activeMemberships: 0,
      reconnectReservations: 0,
      activeStreams: 0,
      activeSubscriptions: 0,
    })

    const projection = await value.rooms.inspectRouteProjection(room.room.id, hostId)
    expect(projection).toMatchObject({
      kind: 'pastStream',
      room: { id: room.room.id, endedAt: value.instant, memberCount: 2, streamCount: 2 },
    })
    expect(value.roomEvents).toContainEqual({ type: 'room-ended', roomId: room.room.id })
    expect(value.homeEvents).toContainEqual({ type: 'room-ended', roomId: room.room.id })
  })

  test('records only private structured enforcement detail and emits no content in realtime', async () => {
    const value = await fixture()
    const hostId = await value.account('Sensitive Host Name')
    const adminId = await value.account('Admin')
    const room = created(await value.rooms.createRoom(hostId, { name: 'Sensitive Room Name' }))

    await value.rooms.adminEndRoom(
      { accountId: adminId, isPlatformAdmin: true },
      room.room.id,
    )

    expect(value.audit).toEqual([
      {
        level: 'info',
        event: 'room.admin_ended',
        actorAccountId: adminId,
        roomId: room.room.id,
        targetAccountId: null,
        outcome: 'ended',
        occurredAt: value.instant.toISOString(),
      },
    ])
    expect(JSON.stringify(value.roomEvents)).not.toContain('Sensitive')
    expect(JSON.stringify(value.homeEvents)).not.toContain('Sensitive')
  })
})
