import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { MembershipService } from '../../src/server/rooms/membership-service'
import { RoomLifecycle } from '../../src/server/rooms/room-lifecycle'
import { RoomService } from '../../src/server/rooms/room-service'
import { TestClock } from '../helpers/test-clock'
import { getIntegrationContext } from '../setup/integration'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const fixtures: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((cleanup) => cleanup()))
})

async function createFixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-lifecycle-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    keyPrefix: '',
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const clock = new TestClock(1_000_000)
  const warnings: Array<{ roomId: string; minutes: number }> = []
  let membership!: MembershipService
  const lifecycle = new RoomLifecycle({
    pool,
    clock,
    onWarning: (warning) => warnings.push(warning),
    onReconnectExpired: (membershipId, reconnectUntil) =>
      membership.expireReconnect(membershipId, reconnectUntil),
  })
  membership = new MembershipService({
    pool,
    clock,
    now: () => new Date(clock.now()),
    scheduleReconnect: (membershipId, reconnectUntil) =>
      lifecycle.scheduleMembership(membershipId, reconnectUntil),
  })
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room-lifecycle:`,
    now: () => new Date(clock.now()),
    revokeConnections: () => undefined,
  })
  const account = async () => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, false, $4, $4)',
      [id, `Member ${id.slice(0, 8)}`, `${id}@example.test`, new Date(clock.now())],
    )
    return id
  }
  fixtures.push(async () => {
    await Promise.all([pool.end(), valkey.quit()])
  })
  return { pool, clock, lifecycle, membership, rooms, warnings, valkey, account }
}

async function flushScheduler(pool: Pool, lifecycle: RoomLifecycle) {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await lifecycle.drain()
  await pool.query('SELECT 1')
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

describe('membership lifecycle', () => {
  test('unexpected disconnect reserves capacity and reclaim restores membership without media', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const member = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Reconnect room' }))
    const joined = await fixture.rooms.admit(member, room.room.id)
    expect(joined.status).toBe('joined')
    if (joined.status !== 'joined') throw new Error('Expected member admission')
    const streamId = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4)',
      [streamId, room.room.id, joined.membership.id, new Date(fixture.clock.now())],
    )

    await expect(fixture.membership.unexpectedDisconnect(member)).resolves.toMatchObject({
      status: 'reserved',
      reconnectUntil: new Date(fixture.clock.now() + 45_000),
    })
    await expect(
      fixture.pool.query(
        'SELECT reconnect_until AS "reconnectUntil", left_at AS "leftAt" FROM room_membership WHERE id = $1',
        [joined.membership.id],
      ),
    ).resolves.toMatchObject({ rows: [{ leftAt: null, reconnectUntil: new Date(fixture.clock.now() + 45_000) }] })
    await expect(
      fixture.pool.query('SELECT ended_at AS "endedAt" FROM stream WHERE id = $1', [streamId]),
    ).resolves.toMatchObject({ rows: [{ endedAt: new Date(fixture.clock.now()) }] })

    await expect(fixture.membership.reclaim(member)).resolves.toMatchObject({
      status: 'reclaimed',
      membership: { id: joined.membership.id },
    })
    await expect(
      fixture.pool.query('SELECT reconnect_until AS "reconnectUntil" FROM room_membership WHERE id = $1', [joined.membership.id]),
    ).resolves.toMatchObject({ rows: [{ reconnectUntil: null }] })
  })

  test('expired unexpected disconnect performs terminal departure and stale reclaim is harmless', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const member = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Disconnect expiry' }))
    const joined = await fixture.rooms.admit(member, room.room.id)
    expect(joined.status).toBe('joined')
    if (joined.status !== 'joined') throw new Error('Expected member admission')

    await fixture.membership.unexpectedDisconnect(member)
    fixture.clock.advanceTo(fixture.clock.now() + 45_001)
    await flushScheduler(fixture.pool, fixture.lifecycle)
    await expect(fixture.membership.reclaim(member)).resolves.toMatchObject({ status: 'not-member' })
    await expect(
      fixture.pool.query('SELECT left_at AS "leftAt", reconnect_until AS "reconnectUntil" FROM room_membership WHERE id = $1', [joined.membership.id]),
    ).resolves.toMatchObject({ rows: [{ reconnectUntil: null, leftAt: new Date(1_045_001) }] })
  })

  test('a stale disconnect does not renew an expired reservation', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const member = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Stale disconnect' }))
    const joined = await fixture.rooms.admit(member, room.room.id)
    expect(joined.status).toBe('joined')
    if (joined.status !== 'joined') throw new Error('Expected member admission')

    const membership = new MembershipService({
      pool: fixture.pool,
      now: () => new Date(fixture.clock.now()),
    })
    const firstResult = await membership.unexpectedDisconnect(member)
    fixture.clock.advanceTo(fixture.clock.now() + 45_000)

    await expect(membership.unexpectedDisconnect(member)).resolves.toMatchObject({
      status: 'not-member',
    })
    await expect(
      fixture.pool.query(
        'SELECT left_at AS "leftAt", reconnect_until AS "reconnectUntil" FROM room_membership WHERE id = $1',
        [joined.membership.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ reconnectUntil: null, leftAt: new Date(1_045_000) }],
    })
  })


  test('concurrent reconnect expiry for one room leaves both memberships terminal', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const first = await fixture.account()
    const second = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Concurrent expiry' }))
    const firstJoin = await fixture.rooms.admit(first, room.room.id)
    const secondJoin = await fixture.rooms.admit(second, room.room.id)
    expect(firstJoin.status).toBe('joined')
    expect(secondJoin.status).toBe('joined')
    if (firstJoin.status !== 'joined' || secondJoin.status !== 'joined') {
      throw new Error('Expected member admissions')
    }

    const membership = new MembershipService({
      pool: fixture.pool,
      now: () => new Date(fixture.clock.now()),
    })
    const firstReservation = await membership.unexpectedDisconnect(first)
    const secondReservation = await membership.unexpectedDisconnect(second)
    expect(firstReservation.status).toBe('reserved')
    expect(secondReservation.status).toBe('reserved')
    if (firstReservation.status !== 'reserved' || secondReservation.status !== 'reserved') {
      throw new Error('Expected reconnect reservations')
    }
    fixture.clock.advanceTo(fixture.clock.now() + 45_000)

    const results = await Promise.all([
      membership.expireReconnect(firstJoin.membership.id, firstReservation.reconnectUntil),
      membership.expireReconnect(secondJoin.membership.id, secondReservation.reconnectUntil),
    ])
    expect(results.every((result) => result.status === 'left')).toBe(true)
    await expect(fixture.rooms.currentMembership(first)).resolves.toBeNull()
    await expect(fixture.rooms.currentMembership(second)).resolves.toBeNull()
  })

  test('disconnect observes a room switch committed while waiting for the account lock', async () => {
    const fixture = await createFixture()
    const oldOwner = await fixture.account()
    const newOwner = await fixture.account()
    const member = await fixture.account()
    const oldRoom = created(await fixture.rooms.createRoom(oldOwner, { name: 'Old room' }))
    const newRoom = created(await fixture.rooms.createRoom(newOwner, { name: 'New room' }))
    const joined = await fixture.rooms.admit(member, oldRoom.room.id)
    expect(joined.status).toBe('joined')
    if (joined.status !== 'joined') throw new Error('Expected member admission')

    const client = await fixture.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM \"user\" WHERE id = $1 FOR UPDATE', [member])
      const switchedAt = new Date(fixture.clock.now())
      await client.query(
        'UPDATE room_membership SET left_at = $2 WHERE account_id = $1 AND left_at IS NULL',
        [member, switchedAt],
      )
      await client.query(
        `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
         VALUES ($1, $2, $3, 'member', $4)`,
        [randomUUID(), newRoom.room.id, member, switchedAt],
      )

      const disconnect = fixture.membership.unexpectedDisconnect(member)
      let waiting = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const lockWaiters = await fixture.pool.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name = current_setting('application_name')
              AND wait_event_type = 'Lock'`,
        )
        if ((lockWaiters.rows[0]?.count ?? 0) > 0) {
          waiting = true
          break
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(waiting).toBe(true)

      await client.query('COMMIT')
      committed = true
      await expect(disconnect).resolves.toMatchObject({
        status: 'reserved',
        roomId: newRoom.room.id,
      })
    } finally {
      if (!committed) await client.query('ROLLBACK')
      client.release()
    }
  })

  test('production RoomService schedules empty-room ending after terminal departures', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const member = await fixture.account()
    const events: Array<{ readonly type: string; readonly roomId?: string }> = []
    const service = new RoomService({
      pool: fixture.pool,
      valkey: fixture.valkey,
      valkeyPrefix: 'room-lifecycle-production:',
      now: () => new Date(fixture.clock.now()),
      clock: fixture.clock,
      publishHomeEvent: (event) => events.push(event),
      revokeConnections: () => undefined,
    })
    const room = created(await service.createRoom(owner, { name: 'Production empty grace' }))
    const joined = await service.admit(member, room.room.id)
    expect(joined.status).toBe('joined')

    await service.terminalDeparture(owner, 'leave')
    await service.terminalDeparture(member, 'leave')
    fixture.clock.advanceTo(fixture.clock.now() + 5 * 60_000)
    await service.drainLifecycle()

    await expect(fixture.pool.query('SELECT ended_at AS "endedAt" FROM room WHERE id = $1', [room.room.id])).resolves.toMatchObject({
      rows: [{ endedAt: new Date(1_000_000 + 5 * 60_000) }],
    })
    expect(events).toContainEqual({ type: 'room-ended', roomId: room.room.id })
  })
  test('terminal departure hands Host to earliest member and final departure starts empty grace', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const first = await fixture.account()
    const revival = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Host succession' }))
    const firstJoin = await fixture.rooms.admit(first, room.room.id)
    expect(firstJoin.status).toBe('joined')
    if (firstJoin.status !== 'joined') throw new Error('Expected member admission')

    await fixture.membership.depart(owner, 'displacement')
    await expect(fixture.rooms.currentMembership(first)).resolves.toMatchObject({ role: 'host' })
    await fixture.membership.depart(first, 'leave')
    await expect(
      fixture.pool.query('SELECT empty_at AS "emptyAt", ended_at AS "endedAt" FROM room WHERE id = $1', [room.room.id]),
    ).resolves.toMatchObject({ rows: [{ emptyAt: new Date(fixture.clock.now()), endedAt: null }] })

    await expect(fixture.rooms.admit(revival, room.room.id)).resolves.toMatchObject({
      status: 'joined',
      role: 'host',
      revived: true,
    })
    await expect(fixture.pool.query('SELECT empty_at AS "emptyAt" FROM room WHERE id = $1', [room.room.id])).resolves.toMatchObject({
      rows: [{ emptyAt: null }],
    })
  })

  test('room lifetime warnings are one-shot and creation time remains immutable', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Warnings' }))
    await fixture.lifecycle.scheduleRoom(room.room.id)

    fixture.clock.advanceTo(fixture.clock.now() + 11 * HOUR_MS + 30 * MINUTE_MS)
    await flushScheduler(fixture.pool, fixture.lifecycle)
    fixture.clock.advanceTo(fixture.clock.now() + 20 * MINUTE_MS)
    await flushScheduler(fixture.pool, fixture.lifecycle)
    fixture.clock.advanceTo(fixture.clock.now() + 9 * MINUTE_MS)
    await flushScheduler(fixture.pool, fixture.lifecycle)
    expect([...fixture.warnings].sort((left, right) => right.minutes - left.minutes)).toEqual([
      { roomId: room.room.id, minutes: 30 },
      { roomId: room.room.id, minutes: 10 },
      { roomId: room.room.id, minutes: 1 },
    ])

    await fixture.pool.query('UPDATE room SET name = $2 WHERE id = $1', [room.room.id, 'Updated'])
    await expect(fixture.rooms.currentMembership(owner)).resolves.toMatchObject({ roomId: room.room.id })
    fixture.clock.advanceTo(1_000_000 + 12 * HOUR_MS + 1)
    await flushScheduler(fixture.pool, fixture.lifecycle)
    await expect(fixture.pool.query('SELECT ended_at AS "endedAt" FROM room WHERE id = $1', [room.room.id])).resolves.toMatchObject({
      rows: [{ endedAt: new Date(1_000_000 + 12 * HOUR_MS) }],
    })
  })
  test('recovery does not emit warning deadlines that already passed', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const room = created(await fixture.rooms.createRoom(owner, { name: 'Warning recovery' }))
    fixture.clock.advanceTo(fixture.clock.now() + 11 * HOUR_MS + 59 * MINUTE_MS)

    const recoveredWarnings: Array<{ roomId: string; minutes: number }> = []
    const recovered = new RoomLifecycle({
      pool: fixture.pool,
      clock: fixture.clock,
      onWarning: (warning) => recoveredWarnings.push(warning),
    })
    await recovered.recover()
    fixture.clock.advanceTo(fixture.clock.now())
    await flushScheduler(fixture.pool, recovered)

    expect(recoveredWarnings).toEqual([])
  })
})
