import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService } from '../../src/server/rooms/room-service'
import { TestClock } from '../helpers/test-clock'
import { getIntegrationContext } from '../setup/integration'

const fixtures: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((cleanup) => cleanup()))
})

async function createFixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-roster-${context.workerId}`,
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
  const homeEvents: Array<{ readonly type: string; readonly roomId?: string }> = []
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room-roster:`,
    now: () => new Date(clock.now()),
    revokeConnections: () => undefined,
    publishHomeEvent: (event) => homeEvents.push(event),
  })
  const account = async (name: string) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, image, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, false, $5, $5)',
      [id, name, `https://cdn.test/${id}.png`, `${id}@example.test`, new Date(clock.now())],
    )
    return id
  }
  fixtures.push(async () => {
    await Promise.all([pool.end(), valkey.quit()])
  })
  return { pool, clock, rooms, account, homeEvents }
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

async function admitted(rooms: RoomService, accountId: string, roomId: string) {
  const projection = await rooms.inspectRouteProjection(roomId, accountId)
  expect(projection?.kind).toBe('admitted')
  if (projection?.kind !== 'admitted') throw new Error('Expected an admitted projection')
  return projection
}

describe('room roster projection', () => {
  test('orders the admitted mosaic as viewer, Host, then join time', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const early = await fixture.account('Ekko')
    const late = await fixture.account('Lior')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Roster room' }))

    fixture.clock.advanceTo(fixture.clock.now() + 60_000)
    expect((await fixture.rooms.admit(early, room.room.id)).status).toBe('joined')
    fixture.clock.advanceTo(fixture.clock.now() + 60_000)
    expect((await fixture.rooms.admit(late, room.room.id)).status).toBe('joined')

    const asLate = await admitted(fixture.rooms, late, room.room.id)
    expect(asLate.room.roster.map((member) => member.displayName)).toEqual([
      'Lior',
      'Hana',
      'Ekko',
    ])

    // The same room, ordered for a different viewer: only the first tile moves.
    const asEarly = await admitted(fixture.rooms, early, room.room.id)
    expect(asEarly.room.roster.map((member) => member.displayName)).toEqual([
      'Ekko',
      'Hana',
      'Lior',
    ])

    // And for the Host, who is the viewer, there is no second promotion.
    const asHost = await admitted(fixture.rooms, host, room.room.id)
    expect(asHost.room.roster.map((member) => member.displayName)).toEqual([
      'Hana',
      'Ekko',
      'Lior',
    ])
  })

  test('carries real identity and current stream state per member', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const watcher = await fixture.account('Wren')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Identity room' }))
    const joined = await fixture.rooms.admit(watcher, room.room.id)
    if (joined.status !== 'joined') throw new Error('Expected member admission')

    const streamId = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4)',
      [streamId, room.room.id, joined.membership.id, new Date(fixture.clock.now())],
    )

    const projection = await admitted(fixture.rooms, watcher, room.room.id)
    expect(projection.room.roster).toMatchObject([
      { displayName: 'Wren', role: 'member', streamId },
      { displayName: 'Hana', role: 'host', streamId: null },
    ])
    for (const member of projection.room.roster) {
      expect(member.avatarUrl).toMatch(/^https:\/\/cdn\.test\//)
      expect(member.joinedAt).toBeInstanceOf(Date)
    }
  })

  test('withholds the roster from a public room until the viewer is admitted', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const visitor = await fixture.account('Vic')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Open room' }))

    const anonymous = await fixture.rooms.inspectRouteProjection(room.room.id, null)
    expect(anonymous?.kind).toBe('preAdmission')
    expect(anonymous?.room).not.toHaveProperty('roster')

    const signedOut = await fixture.rooms.inspectRouteProjection(room.room.id, visitor)
    expect(signedOut?.kind).toBe('preAdmission')
    expect(signedOut?.room).not.toHaveProperty('roster')
    expect(JSON.stringify(signedOut)).not.toContain('Hana')
  })

  test('withholds the roster from a private room before the password gate', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const visitor = await fixture.account('Vic')
    const room = created(
      await fixture.rooms.createRoom(host, {
        name: 'Locked room',
        visibility: 'private',
        password: 'correct horse battery',
      }),
    )

    const outside = await fixture.rooms.inspectRouteProjection(room.room.id, visitor)
    expect(outside?.kind).toBe('preAdmission')
    expect(JSON.stringify(outside)).not.toContain('Hana')

    expect(
      (
        await fixture.rooms.admit(visitor, room.room.id, {
          password: 'correct horse battery',
        })
      ).status,
    ).toBe('joined')

    const inside = await admitted(fixture.rooms, visitor, room.room.id)
    expect(inside.room.roster.map((member) => member.displayName)).toEqual(['Vic', 'Hana'])
  })

  test('drops the roster when an admitted member is displaced to pre-admission', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Displacement room' }))

    const projection = await admitted(fixture.rooms, host, room.room.id)
    expect(projection.room.roster).toHaveLength(1)

    const { projectDisplacedRoom } = await import('../../src/server/rooms/room-projection')
    const displaced = projectDisplacedRoom(projection)
    expect(displaced.room).not.toHaveProperty('roster')
    expect(JSON.stringify(displaced)).not.toContain('Hana')
  })

  test('leaves a departed member out of the roster', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const leaver = await fixture.account('Lee')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Leaving room' }))
    const joined = await fixture.rooms.admit(leaver, room.room.id)
    if (joined.status !== 'joined') throw new Error('Expected member admission')

    await fixture.pool.query('UPDATE room_membership SET left_at = $2 WHERE id = $1', [
      joined.membership.id,
      new Date(fixture.clock.now()),
    ])

    const projection = await admitted(fixture.rooms, host, room.room.id)
    expect(projection.room.roster.map((member) => member.displayName)).toEqual(['Hana'])
  })
  // The room page has no channel of its own: RoomRoute listens on the Home
  // socket and `applyRoomProjectionRealtimeEvent` turns any event carrying this
  // room's id into a projection invalidation. This proves the producing half —
  // that a membership change actually emits one — so the roster is live rather
  // than load-time only.
  test('emits a room-membership event on join and on leave so the roster refetches', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const joiner = await fixture.account('Jules')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Live roster room' }))

    fixture.homeEvents.length = 0
    fixture.clock.advanceTo(fixture.clock.now() + 60_000)
    expect((await fixture.rooms.admit(joiner, room.room.id)).status).toBe('joined')

    expect(
      fixture.homeEvents.filter(
        (event) => event.type === 'room-membership' && event.roomId === room.room.id,
      ),
    ).not.toHaveLength(0)
    expect(
      (await admitted(fixture.rooms, host, room.room.id)).room.roster.map(
        (member) => member.displayName,
      ),
    ).toEqual(['Hana', 'Jules'])

    fixture.homeEvents.length = 0
    const departure = await fixture.rooms.terminalDeparture(joiner, 'displacement')
    expect(departure.status).not.toBe('not-member')

    expect(
      fixture.homeEvents.filter(
        (event) => event.type === 'room-membership' && event.roomId === room.room.id,
      ),
    ).not.toHaveLength(0)
    expect(
      (await admitted(fixture.rooms, host, room.room.id)).room.roster.map(
        (member) => member.displayName,
      ),
    ).toEqual(['Hana'])
  })
})
