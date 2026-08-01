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
import type { RoomRealtimeEvent } from '../../src/server/realtime/room-events'
import { getIntegrationContext } from '../setup/integration'

interface Fixture {
  readonly pool: Pool
  readonly service: RoomService
  readonly roomEvents: RoomRealtimeEvent[]
  readonly audit: RoomModerationAuditEntry[]
  account(name: string): Promise<string>
  close(): Promise<void>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function fixture(
  auditSink?: (entry: RoomModerationAuditEntry) => void,
): Promise<Fixture> {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-host-transfer-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    keyPrefix: '',
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const roomEvents: RoomRealtimeEvent[] = []
  const audit: RoomModerationAuditEntry[] = []
  const service = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room-host-transfer:`,
    revokeConnections: () => undefined,
    publishRoomEvent: (event) => roomEvents.push(event),
    moderationAudit: auditSink ?? ((entry) => audit.push(entry)),
  })
  const result: Fixture = {
    pool,
    service,
    roomEvents,
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

describe('voluntary Host transfer', () => {
  test('authorizes the current Host, rejects invalid targets, and preserves memberships and media atomically', async () => {
    const context = await fixture()
    const [hostId, targetId, ordinaryId, outsiderId] = await Promise.all([
      context.account('Original Host'),
      context.account('New Host'),
      context.account('Ordinary Member'),
      context.account('Outside Account'),
    ])
    const room = created(
      await context.service.createRoom(hostId, { name: 'Host transfer contract' }),
    )
    await context.service.admit(targetId, room.room.id)
    await context.service.admit(ordinaryId, room.room.id)

    await expect(
      context.service.transferHost(ordinaryId, room.room.id, targetId),
    ).resolves.toEqual({ status: 'forbidden' })
    await expect(
      context.service.transferHost(hostId, room.room.id, outsiderId),
    ).resolves.toEqual({ status: 'not-member' })
    await expect(
      context.service.transferHost(hostId, room.room.id, hostId),
    ).resolves.toEqual({ status: 'invalid-target' })

    const memberships = await context.pool.query<{ id: string; accountId: string }>(
      `SELECT id, account_id AS "accountId"
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL`,
      [room.room.id],
    )
    const membershipId = (accountId: string) => {
      const id = memberships.rows.find((row) => row.accountId === accountId)?.id
      if (!id) throw new Error(`Missing membership for ${accountId}`)
      return id
    }
    const streamId = randomUUID()
    const subscriptionId = randomUUID()
    await context.pool.query(
      `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at)
       VALUES ($1, $2, $3, 'host-transfer-preview', now(), now())`,
      [streamId, room.room.id, membershipId(targetId)],
    )
    await context.pool.query(
      `INSERT INTO stream_subscription (id, viewer_membership_id, stream_id, started_at)
       VALUES ($1, $2, $3, now())`,
      [subscriptionId, membershipId(ordinaryId), streamId],
    )

    await expect(
      context.service.transferHost(hostId, room.room.id, targetId),
    ).resolves.toEqual({ status: 'transferred' })

    const canonical = await context.pool.query<{
      accountId: string
      role: 'host' | 'member'
      leftAt: Date | null
      streamEndedAt: Date | null
      subscriptionEndedAt: Date | null
    }>(
      `SELECT membership.account_id AS "accountId",
              membership.role,
              membership.left_at AS "leftAt",
              stream.ended_at AS "streamEndedAt",
              subscription.ended_at AS "subscriptionEndedAt"
         FROM room_membership membership
         LEFT JOIN stream ON stream.id = $2
         LEFT JOIN stream_subscription subscription ON subscription.id = $3
        WHERE membership.room_id = $1
        ORDER BY membership.account_id`,
      [room.room.id, streamId, subscriptionId],
    )
    expect(canonical.rows).toHaveLength(3)
    expect(canonical.rows.find((row) => row.accountId === hostId)).toMatchObject({
      role: 'member',
      leftAt: null,
      streamEndedAt: null,
      subscriptionEndedAt: null,
    })
    expect(canonical.rows.find((row) => row.accountId === targetId)).toMatchObject({
      role: 'host',
      leftAt: null,
      streamEndedAt: null,
      subscriptionEndedAt: null,
    })
    expect(canonical.rows.find((row) => row.accountId === ordinaryId)).toMatchObject({
      role: 'member',
      leftAt: null,
      streamEndedAt: null,
      subscriptionEndedAt: null,
    })

    expect(
      context.roomEvents.filter((event) => event.type === 'membership-changed'),
    ).toContainEqual({ type: 'membership-changed', roomId: room.room.id })
    expect(
      context.roomEvents.filter(
        (event) => event.type === 'activity' && event.entry.kind === 'host-transferred',
      ),
    ).toMatchObject([
      {
        type: 'activity',
        roomId: room.room.id,
        entry: { kind: 'host-transferred', displayName: 'New Host' },
      },
    ])
    expect(context.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'room.host_transferred',
          actorAccountId: ordinaryId,
          targetAccountId: targetId,
          outcome: 'forbidden',
        }),
        expect.objectContaining({
          event: 'room.host_transferred',
          actorAccountId: hostId,
          targetAccountId: outsiderId,
          outcome: 'not-member',
        }),
        expect.objectContaining({
          event: 'room.host_transferred',
          actorAccountId: hostId,
          targetAccountId: hostId,
          outcome: 'invalid-target',
        }),
        expect.objectContaining({
          event: 'room.host_transferred',
          actorAccountId: hostId,
          targetAccountId: targetId,
          outcome: 'transferred',
        }),
      ]),
    )
    for (const entry of context.audit) {
      expect(Object.keys(entry).sort()).toEqual([
        'actorAccountId',
        'event',
        'level',
        'occurredAt',
        'outcome',
        'roomId',
        'targetAccountId',
      ])
    }
  })

  test('keeps a committed transfer successful when private audit delivery fails', async () => {
    const context = await fixture(() => {
      throw new Error('audit unavailable')
    })
    const [hostId, targetId] = await Promise.all([
      context.account('Original Host'),
      context.account('New Host'),
    ])
    const room = created(
      await context.service.createRoom(hostId, { name: 'Audit isolation contract' }),
    )
    await context.service.admit(targetId, room.room.id)

    await expect(
      context.service.transferHost(hostId, room.room.id, targetId),
    ).resolves.toEqual({ status: 'transferred' })
    await expect(context.service.currentMembership(hostId)).resolves.toMatchObject({
      role: 'member',
    })
    await expect(context.service.currentMembership(targetId)).resolves.toMatchObject({
      role: 'host',
    })
  })
})
