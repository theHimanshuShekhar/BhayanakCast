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
  readonly revokedAccountIds: [accountId: string, roomId: string][]
  account(name: string): Promise<string>
  close(): Promise<void>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function fixture(auditThrows = false): Promise<Fixture> {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-kicks-${context.workerId}`,
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
  const revokedAccountIds: [accountId: string, roomId: string][] = []
  const service = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room-kick:`,
    revokeConnections: () => undefined,
    revokeRoomConnections: (accountId, roomId) => {
      revokedAccountIds.push([accountId, roomId])
    },
    publishRoomEvent: (event) => roomEvents.push(event),
    moderationAudit: (entry) => {
      audit.push(entry)
      if (auditThrows) throw new Error('audit unavailable')
    },
  })
  const result: Fixture = {
    pool,
    service,
    roomEvents,
    audit,
    revokedAccountIds,
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

describe('Host kick', () => {
  test('authorizes only the current Host, performs canonical cleanup without a ban, and permits immediate re-entry', async () => {
    const test = await fixture()
    const [hostId, targetId, watcherId, outsiderId] = await Promise.all([
      test.account('Kick Host'),
      test.account('Kick Target'),
      test.account('Kick Watcher'),
      test.account('Kick Outsider'),
    ])
    const room = created(await test.service.createRoom(hostId, { name: 'Kick contract' }))
    await test.service.admit(targetId, room.room.id)
    await test.service.admit(watcherId, room.room.id)

    await expect(test.service.kickAccount(targetId, room.room.id, hostId)).resolves.toEqual({
      status: 'forbidden',
    })
    await expect(test.service.kickAccount(hostId, room.room.id, hostId)).resolves.toEqual({
      status: 'invalid-target',
    })
    await expect(test.service.kickAccount(hostId, room.room.id, outsiderId)).resolves.toEqual({
      status: 'not-member',
    })

    const memberships = await test.pool.query<{ id: string; accountId: string }>(
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
    const targetStreamId = randomUUID()
    const hostStreamId = randomUUID()
    await test.pool.query(
      `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at)
       VALUES ($1, $3, $4, 'kick-preview', now(), now()),
              ($2, $3, $5, 'host-preview', now(), now())`,
      [targetStreamId, hostStreamId, room.room.id, membershipId(targetId), membershipId(hostId)],
    )
    await test.pool.query(
      `INSERT INTO stream_subscription (id, viewer_membership_id, stream_id, started_at)
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        randomUUID(),
        membershipId(watcherId),
        targetStreamId,
        randomUUID(),
        membershipId(targetId),
        hostStreamId,
      ],
    )

    await expect(test.service.kickAccount(hostId, room.room.id, targetId)).resolves.toEqual({
      status: 'kicked',
    })
    expect(test.revokedAccountIds).toEqual([[targetId, room.room.id]])

    const canonical = await test.pool.query<{
      leftAt: Date | null
      streamEndedAt: Date | null
      previewKey: string | null
      activeRelatedSubscriptions: number
      banCount: number
      activeMemberships: number
      hostCount: number
      emptyAt: Date | null
      endedAt: Date | null
    }>(
      `SELECT membership.left_at AS "leftAt",
              target_stream.ended_at AS "streamEndedAt",
              target_stream.preview_key AS "previewKey",
              (
                SELECT count(*)::int
                  FROM stream_subscription subscription
                  LEFT JOIN stream subscribed_stream ON subscribed_stream.id = subscription.stream_id
                 WHERE subscription.ended_at IS NULL
                   AND (
                     subscription.viewer_membership_id = membership.id OR
                     subscribed_stream.membership_id = membership.id
                   )
              ) AS "activeRelatedSubscriptions",
              (SELECT count(*)::int FROM room_ban WHERE room_id = membership.room_id) AS "banCount",
              (SELECT count(*)::int FROM room_membership WHERE room_id = membership.room_id AND left_at IS NULL) AS "activeMemberships",
              (SELECT count(*)::int FROM room_membership WHERE room_id = membership.room_id AND left_at IS NULL AND role = 'host') AS "hostCount",
              room.empty_at AS "emptyAt",
              room.ended_at AS "endedAt"
         FROM room_membership membership
         JOIN room ON room.id = membership.room_id
         JOIN stream target_stream ON target_stream.membership_id = membership.id
        WHERE membership.room_id = $1 AND membership.account_id = $2`,
      [room.room.id, targetId],
    )
    expect(canonical.rows[0]).toMatchObject({
      leftAt: expect.any(Date),
      streamEndedAt: expect.any(Date),
      previewKey: null,
      activeRelatedSubscriptions: 0,
      banCount: 0,
      activeMemberships: 2,
      hostCount: 1,
      emptyAt: null,
      endedAt: null,
    })
    await expect(test.service.currentMembership(hostId)).resolves.toMatchObject({
      roomId: room.room.id,
      role: 'host',
    })
    await expect(test.service.currentMembership(targetId)).resolves.toBeNull()
    await expect(test.service.inspectPreAdmission(room.room.id, targetId)).resolves.toMatchObject({
      status: 'active',
    })
    await expect(test.service.admit(targetId, room.room.id)).resolves.toMatchObject({
      status: 'joined',
      role: 'member',
    })

    const removalActivity = test.roomEvents.filter(
      (event) => event.type === 'activity' && event.entry.kind === 'member-removed',
    )
    expect(removalActivity).toHaveLength(1)
    expect(removalActivity[0]).toMatchObject({
      type: 'activity',
      roomId: room.room.id,
      entry: { kind: 'member-removed', displayName: 'Kick Target' },
    })
    expect(
      Object.keys((removalActivity[0] as Extract<RoomRealtimeEvent, { type: 'activity' }>).entry).sort(),
    ).toEqual(['at', 'displayName', 'id', 'kind'])
    expect(test.roomEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'membership-changed', roomId: room.room.id }),
      ]),
    )
    expect(test.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'room.member_kicked',
          actorAccountId: targetId,
          targetAccountId: hostId,
          roomId: room.room.id,
          outcome: 'forbidden',
        }),
        expect.objectContaining({
          event: 'room.member_kicked',
          actorAccountId: hostId,
          targetAccountId: targetId,
          roomId: room.room.id,
          outcome: 'kicked',
        }),
      ]),
    )
  })

  test('keeps an accepted kick committed when private audit delivery fails', async () => {
    const test = await fixture(true)
    const hostId = await test.account('Audit Host')
    const targetId = await test.account('Audit Target')
    const room = created(await test.service.createRoom(hostId, { name: 'Kick audit isolation' }))
    await test.service.admit(targetId, room.room.id)

    await expect(test.service.kickAccount(hostId, room.room.id, targetId)).resolves.toEqual({
      status: 'kicked',
    })
    await expect(test.service.currentMembership(targetId)).resolves.toBeNull()
    await expect(test.pool.query('SELECT 1 FROM room_ban WHERE room_id = $1', [room.room.id])).resolves.toMatchObject({
      rowCount: 0,
    })
  })
})
