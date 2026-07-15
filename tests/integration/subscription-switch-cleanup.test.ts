import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService } from '../../src/server/rooms/room-service'
import { SubscriptionService } from '../../src/server/streams/subscription-service'
import { getIntegrationContext } from '../setup/integration'

const resources: Array<{ pool: Pool; valkey: Redis }> = []

afterEach(async () => {
  await Promise.all(
    resources.splice(0).flatMap(({ pool, valkey }) => [pool.end(), valkey.quit()]),
  )
})

async function setup() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `subscription-switch-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  resources.push({ pool, valkey })
  let instant = Date.now()
  const now = instant
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}switch:`,
    now: () => new Date(instant),
    revokeConnections: () => undefined,
  })
  const subscriptions = new SubscriptionService(pool, () => new Date(instant))
  const account = async () => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, false, now(), now())',
      [id, `Member ${id.slice(0, 8)}`, `${id}@example.test`],
    )
    return id
  }
  return {
    pool,
    rooms,
    subscriptions,
    account,
    now,
    advance: (milliseconds: number) => {
      instant += milliseconds
    },
  }
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

async function waitForSubscriptionLockContention(
  pool: Pool,
  blockerPid: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const blocked = await pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity activity
          WHERE $1 = ANY(pg_blocking_pids(activity.pid))
       ) AS blocked`,
      [blockerPid],
    )
    if (blocked.rows[0]?.blocked) return
    await wait(10)
  }
  throw new Error('Subscription did not reach the locked active subscription')
}

describe('canonical subscription cleanup during room switching', () => {
  test("rejects a stream whose publisher membership belongs to another room", async () => {
    const fixture = await setup()
    const [firstOwner, secondOwner] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const firstRoom = created(
      await fixture.rooms.createRoom(firstOwner, { name: 'First room' }),
    )
    const secondRoom = created(
      await fixture.rooms.createRoom(secondOwner, { name: 'Second room' }),
    )

    await expect(
      fixture.pool.query(
        'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4)',
        [
          randomUUID(),
          firstRoom.room.id,
          secondRoom.membership.id,
          new Date(fixture.now),
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })
  test('preserves source state on target failure and closes the source stream and subscription on confirmed success', async () => {
    const fixture = await setup()
    const [sourceOwner, switchingAccount, targetOwner] = await Promise.all([
      fixture.account(),
      fixture.account(),
      fixture.account(),
    ])
    const source = created(
      await fixture.rooms.createRoom(sourceOwner, { name: 'Source room' }),
    )
    const switchingMembership = await fixture.rooms.admit(
      switchingAccount,
      source.room.id,
    )
    expect(switchingMembership.status).toBe('joined')
    if (switchingMembership.status !== 'joined') throw new Error('Expected source admission')
    const target = created(
      await fixture.rooms.createRoom(targetOwner, {
        name: 'Private target',
        visibility: 'private',
        password: 'correct horse',
      }),
    )

    const ownerStreamId = randomUUID()
    const switchingStreamId = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4), ($5, $2, $6, $4)',
      [
        ownerStreamId,
        source.room.id,
        source.membership.id,
        new Date(fixture.now),
        switchingStreamId,
        switchingMembership.membership.id,
      ],
    )
    await fixture.pool.query(
      'UPDATE stream SET preview_key = $2, preview_updated_at = $3 WHERE id = $1',
      [switchingStreamId, 'previews/private-source.webp', new Date(fixture.now)],
    )
    await expect(
      fixture.subscriptions.subscribe(
        switchingMembership.membership.id,
        ownerStreamId,
      ),
    ).resolves.toMatchObject({ status: 'subscribed' })

    await expect(
      fixture.rooms.admit(switchingAccount, target.room.id, {
        password: 'wrong password',
      }),
    ).resolves.toMatchObject({ status: 'invalid-password' })
    await expect(
      fixture.rooms.currentMembership(switchingAccount),
    ).resolves.toMatchObject({ roomId: source.room.id })
    await expect(
      fixture.subscriptions.current(switchingMembership.membership.id),
    ).resolves.toMatchObject({ streamId: ownerStreamId })
    const streamBeforeConfirmation = await fixture.pool.query(
      'SELECT ended_at FROM stream WHERE id = $1',
      [switchingStreamId],
    )
    expect(streamBeforeConfirmation.rows[0]?.ended_at).toBeNull()

    const confirmationRequired = await fixture.rooms.admit(
      switchingAccount,
      target.room.id,
      { password: 'correct horse' },
    )
    expect(confirmationRequired).toMatchObject({
      status: 'confirmation-required',
      consequences: expect.arrayContaining(['stop-stream']),
    })
    if (confirmationRequired.status !== 'confirmation-required') {
      throw new Error('Expected source consequence confirmation')
    }
    await fixture.pool.query(`
      CREATE FUNCTION reject_target_membership() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.room_id = '${target.room.id}'::uuid THEN
          RAISE EXCEPTION 'injected target admission failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER reject_target_membership
      BEFORE INSERT ON room_membership
      FOR EACH ROW EXECUTE FUNCTION reject_target_membership();
    `)
    await expect(
      fixture.rooms.admit(switchingAccount, target.room.id, {
        password: 'correct horse',
        confirmation: confirmationRequired.confirmation,
      }),
    ).rejects.toThrow('injected target admission failure')
    await fixture.pool.query(`
      DROP TRIGGER reject_target_membership ON room_membership;
      DROP FUNCTION reject_target_membership();
    `)
    await expect(
      fixture.rooms.currentMembership(switchingAccount),
    ).resolves.toMatchObject({ roomId: source.room.id })
    await expect(
      fixture.subscriptions.current(switchingMembership.membership.id),
    ).resolves.toMatchObject({ streamId: ownerStreamId })
    const streamAfterRollback = await fixture.pool.query(
      'SELECT ended_at FROM stream WHERE id = $1',
      [switchingStreamId],
    )
    expect(streamAfterRollback.rows[0]?.ended_at).toBeNull()
    await expect(
      fixture.rooms.admit(switchingAccount, target.room.id, {
        password: 'correct horse',
        confirmation: confirmationRequired.confirmation,
      }),
    ).resolves.toMatchObject({ status: 'joined' })

    await expect(
      fixture.rooms.currentMembership(switchingAccount),
    ).resolves.toMatchObject({ roomId: target.room.id })
    await expect(
      fixture.subscriptions.current(switchingMembership.membership.id),
    ).resolves.toBeNull()
    const streamAfterSwitch = await fixture.pool.query(
      'SELECT ended_at, preview_key FROM stream WHERE id = $1',
      [switchingStreamId],
    )
    expect(streamAfterSwitch.rows[0]?.ended_at).toEqual(expect.any(Date))
    expect(streamAfterSwitch.rows[0]?.preview_key).toBeNull()
  })

  test('replaces the viewer sole active remote subscription target-first', async () => {
    const fixture = await setup()
    const [owner, viewer, otherStreamer] = await Promise.all([
      fixture.account(),
      fixture.account(),
      fixture.account(),
    ])
    const room = created(
      await fixture.rooms.createRoom(owner, { name: 'Watch room' }),
    )
    const viewerMembership = await fixture.rooms.admit(viewer, room.room.id)
    const otherMembership = await fixture.rooms.admit(otherStreamer, room.room.id)
    if (viewerMembership.status !== 'joined' || otherMembership.status !== 'joined') {
      throw new Error('Expected source admissions')
    }
    const firstStream = randomUUID()
    const secondStream = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $3, $4, $5), ($2, $3, $6, $5)',
      [
        firstStream,
        secondStream,
        room.room.id,
        room.membership.id,
        new Date(fixture.now),
        otherMembership.membership.id,
      ],
    )

    const first = await fixture.subscriptions.subscribe(
      viewerMembership.membership.id,
      firstStream,
    )
    const second = await fixture.subscriptions.subscribe(
      viewerMembership.membership.id,
      secondStream,
    )
    expect(first).toMatchObject({ status: 'subscribed' })
    expect(second).toMatchObject({ status: 'subscribed', streamId: secondStream })

    const active = await fixture.pool.query(
      'SELECT stream_id FROM stream_subscription WHERE viewer_membership_id = $1 AND ended_at IS NULL',
      [viewerMembership.membership.id],
    )
    expect(active.rows).toEqual([{ stream_id: secondStream }])
  })

  test('serializes opposite-direction room switches without a deadlock', async () => {
    const fixture = await setup()
    const [firstAccount, secondAccount] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const firstRoom = created(
      await fixture.rooms.createRoom(firstAccount, { name: 'First source' }),
    ).room
    const secondRoom = created(
      await fixture.rooms.createRoom(secondAccount, { name: 'Second source' }),
    ).room
    const [firstConfirmation, secondConfirmation] = await Promise.all([
      fixture.rooms.admit(firstAccount, secondRoom.id),
      fixture.rooms.admit(secondAccount, firstRoom.id),
    ])
    if (
      firstConfirmation.status !== 'confirmation-required' ||
      secondConfirmation.status !== 'confirmation-required'
    ) {
      throw new Error('Expected both Host transfers to require confirmation')
    }

    const [firstSwitch, secondSwitch] = await Promise.all([
      fixture.rooms.admit(firstAccount, secondRoom.id, {
        confirmation: firstConfirmation.confirmation,
      }),
      fixture.rooms.admit(secondAccount, firstRoom.id, {
        confirmation: secondConfirmation.confirmation,
      }),
    ])

    expect(firstSwitch).toMatchObject({ status: 'joined' })
    expect(secondSwitch).toMatchObject({ status: 'joined' })
    await expect(
      fixture.rooms.currentMembership(firstAccount),
    ).resolves.toMatchObject({ roomId: secondRoom.id })
    await expect(
      fixture.rooms.currentMembership(secondAccount),
    ).resolves.toMatchObject({ roomId: firstRoom.id })
  })


  test('does not leave a subscription behind a concurrent publisher departure', async () => {
    const fixture = await setup()
    const [owner, viewerAccount, publisherAccount] = await Promise.all([
      fixture.account(),
      fixture.account(),
      fixture.account(),
    ])
    const room = created(
      await fixture.rooms.createRoom(owner, { name: 'Departure race' }),
    )
    const viewer = await fixture.rooms.admit(viewerAccount, room.room.id)
    const publisher = await fixture.rooms.admit(publisherAccount, room.room.id)
    if (viewer.status !== 'joined' || publisher.status !== 'joined') {
      throw new Error('Expected viewer and publisher admission')
    }
    const firstStream = randomUUID()
    const departingStream = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $3, $4, $5), ($2, $3, $6, $5)',
      [
        firstStream,
        departingStream,
        room.room.id,
        room.membership.id,
        new Date(fixture.now),
        publisher.membership.id,
      ],
    )
    await fixture.subscriptions.subscribe(viewer.membership.id, firstStream)
    const departureConfirmation = await fixture.rooms.leave(publisherAccount)
    if (departureConfirmation.status !== 'confirmation-required') {
      throw new Error('Expected active Stream departure confirmation')
    }

    const blocker = await fixture.pool.connect()
    try {
      await blocker.query('BEGIN')
      const backend = await blocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      await blocker.query(
        'SELECT id FROM stream_subscription WHERE viewer_membership_id = $1 AND ended_at IS NULL FOR UPDATE',
        [viewer.membership.id],
      )
      const switching = fixture.subscriptions.subscribe(
        viewer.membership.id,
        departingStream,
      )
      await waitForSubscriptionLockContention(
        fixture.pool,
        backend.rows[0]?.pid ?? -1,
      )
      const departure = fixture.rooms.leave(publisherAccount, {
        confirmation: departureConfirmation.confirmation,
      })
      await wait(50)
      await blocker.query('COMMIT')
      await Promise.all([switching, departure])
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
    }

    await expect(
      fixture.subscriptions.current(viewer.membership.id),
    ).resolves.toBeNull()
  })
  test('rejects subscriptions once the room lifetime is due', async () => {
    const fixture = await setup()
    const [owner, viewer] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const createdRoom = created(
      await fixture.rooms.createRoom(owner, { name: 'Expiring stream' }),
    )
    const viewerAdmission = await fixture.rooms.admit(viewer, createdRoom.room.id)
    if (viewerAdmission.status !== 'joined') {
      throw new Error('Expected viewer admission')
    }
    const streamId = randomUUID()
    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4)',
      [
        streamId,
        createdRoom.room.id,
        createdRoom.membership.id,
        new Date(fixture.now),
      ],
    )

    await expect(
      fixture.subscriptions.subscribe(viewerAdmission.membership.id, streamId),
    ).resolves.toMatchObject({ status: 'subscribed' })

    fixture.advance(12 * 60 * 60 * 1_000)
    await expect(
      fixture.subscriptions.subscribe(viewerAdmission.membership.id, streamId),
    ).resolves.toMatchObject({ status: 'stream-unavailable' })
    await expect(
      fixture.subscriptions.current(viewerAdmission.membership.id),
    ).resolves.toBeNull()
    const persisted = await fixture.pool.query<{
      endedAt: Date | null
      activeMemberships: number
      activeStreams: number
    }>(
      `SELECT room.ended_at AS "endedAt",
              count(DISTINCT membership.id)::integer AS "activeMemberships",
              count(DISTINCT stream.id)::integer AS "activeStreams"
         FROM room
         LEFT JOIN room_membership membership
           ON membership.room_id = room.id AND membership.left_at IS NULL
         LEFT JOIN stream
           ON stream.room_id = room.id AND stream.ended_at IS NULL
        WHERE room.id = $1
        GROUP BY room.id`,
      [createdRoom.room.id],
    )
    expect(persisted.rows[0]).toEqual({
      endedAt: new Date(createdRoom.room.createdAt.getTime() + 12 * 60 * 60 * 1_000),
      activeMemberships: 0,
      activeStreams: 0,
    })
  })
})
