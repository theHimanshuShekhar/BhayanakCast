import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService, type CreateRoomResult } from '../../src/server/rooms/room-service'
import {
  StreamService,
  type StreamModerationAuditEntry,
} from '../../src/server/streams/stream-service'
import { SubscriptionService } from '../../src/server/streams/subscription-service'
import { getIntegrationContext } from '../setup/integration'

interface Fixture {
  readonly pool: Pool
  readonly valkey: Redis
  readonly rooms: RoomService
  readonly streams: StreamService
  readonly subscriptions: SubscriptionService
  readonly audit: StreamModerationAuditEntry[]
  account(name: string): Promise<string>
  close(): Promise<void>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function fixture(): Promise<Fixture> {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `host-stream-stop-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    keyPrefix: '',
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const audit: StreamModerationAuditEntry[] = []
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}host-stream-stop:`,
    revokeConnections: () => undefined,
  })
  const streams = new StreamService({
    pool,
    moderationAudit: (entry) => {
      audit.push(entry)
      if (entry.outcome === 'stopped') throw new Error('audit sink unavailable')
    },
  })
  const result: Fixture = {
    pool,
    valkey,
    rooms,
    streams,
    subscriptions: new SubscriptionService(pool),
    audit,
    async account(name) {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, now(), now())`,
        [id, name, `${id}@example.test`],
      )
      return id
    },
    async close() {
      await Promise.all([pool.end(), valkey.quit()])
    },
  }
  fixtures.push(result)
  return result
}

function created(result: CreateRoomResult) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

async function membershipId(test: Fixture, accountId: string, roomId: string) {
  const result = await test.pool.query<{ id: string }>(
    `SELECT id FROM room_membership
      WHERE account_id = $1 AND room_id = $2 AND left_at IS NULL`,
    [accountId, roomId],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error(`Missing membership for ${accountId}`)
  return id
}

describe('Host Stream Stop', () => {
  test('authorizes only the Host, cleans only the selected Stream, preserves membership, attributes actor/subject, and permits restart', async () => {
    const test = await fixture()
    const [hostId, ownerId, viewerId] = await Promise.all([
      test.account('Host Account'),
      test.account('Stream Owner'),
      test.account('Viewer Account'),
    ])
    const room = created(await test.rooms.createRoom(hostId, { name: 'Host stop room' }))
    await test.rooms.admit(ownerId, room.room.id)
    await test.rooms.admit(viewerId, room.room.id)
    const [ownerMembershipId, viewerMembershipId] = await Promise.all([
      membershipId(test, ownerId, room.room.id),
      membershipId(test, viewerId, room.room.id),
    ])
    const ownerStream = await test.streams.start(ownerId, room.room.id)
    const hostStream = await test.streams.start(hostId, room.room.id)
    expect(ownerStream.status).toBe('started')
    expect(hostStream.status).toBe('started')
    if (ownerStream.status !== 'started' || hostStream.status !== 'started') {
      throw new Error('Expected both Streams to start')
    }
    const ownerViewer = await test.subscriptions.subscribe(viewerMembershipId, ownerStream.streamId)
    const hostViewer = await test.subscriptions.subscribe(ownerMembershipId, hostStream.streamId)
    expect(ownerViewer.status).toBe('subscribed')
    expect(hostViewer.status).toBe('subscribed')

    await expect(
      test.streams.stopByHost(viewerId, {
        roomId: room.room.id,
        targetAccountId: ownerId,
        streamId: ownerStream.streamId,
      }),
    ).resolves.toEqual({ status: 'not-authorized' })

    await expect(
      test.streams.stopByHost(hostId, {
        roomId: room.room.id,
        targetAccountId: ownerId,
        streamId: ownerStream.streamId,
      }),
    ).resolves.toMatchObject({
      status: 'stopped',
      streamId: ownerStream.streamId,
      roomId: room.room.id,
      membershipId: ownerMembershipId,
      targetAccountId: ownerId,
      targetDisplayName: 'Stream Owner',
      endedSubscriptionIds:
        ownerViewer.status === 'subscribed' ? [ownerViewer.id] : expect.any(Array),
    })

    const state = await test.pool.query<{
      ownerLeftAt: Date | null
      ownerStreamEndedAt: Date | null
      ownerWatchEndedAt: Date | null
      hostStreamEndedAt: Date | null
      hostWatchEndedAt: Date | null
    }>(
      `SELECT
         (SELECT left_at FROM room_membership WHERE id = $1) AS "ownerLeftAt",
         (SELECT ended_at FROM stream WHERE id = $2) AS "ownerStreamEndedAt",
         (SELECT ended_at FROM stream_subscription WHERE id = $3) AS "ownerWatchEndedAt",
         (SELECT ended_at FROM stream WHERE id = $4) AS "hostStreamEndedAt",
         (SELECT ended_at FROM stream_subscription WHERE id = $5) AS "hostWatchEndedAt"`,
      [
        ownerMembershipId,
        ownerStream.streamId,
        ownerViewer.status === 'subscribed' ? ownerViewer.id : randomUUID(),
        hostStream.streamId,
        hostViewer.status === 'subscribed' ? hostViewer.id : randomUUID(),
      ],
    )
    expect(state.rows[0]).toMatchObject({
      ownerLeftAt: null,
      ownerStreamEndedAt: expect.any(Date),
      ownerWatchEndedAt: expect.any(Date),
      hostStreamEndedAt: null,
      hostWatchEndedAt: null,
    })
    await expect(test.rooms.currentMembership(ownerId)).resolves.toMatchObject({
      id: ownerMembershipId,
      roomId: room.room.id,
      role: 'member',
    })

    const restarted = await test.streams.start(ownerId, room.room.id)
    expect(restarted).toMatchObject({
      status: 'started',
      roomId: room.room.id,
      membershipId: ownerMembershipId,
    })
    if (restarted.status === 'started') expect(restarted.streamId).not.toBe(ownerStream.streamId)

    expect(test.audit).toEqual([
      expect.objectContaining({
        event: 'room.stream_stopped_by_host',
        actorAccountId: viewerId,
        targetAccountId: ownerId,
        roomId: room.room.id,
        streamId: ownerStream.streamId,
        outcome: 'not-authorized',
      }),
      expect.objectContaining({
        event: 'room.stream_stopped_by_host',
        actorAccountId: hostId,
        targetAccountId: ownerId,
        roomId: room.room.id,
        streamId: ownerStream.streamId,
        outcome: 'stopped',
      }),
    ])
  })
})
