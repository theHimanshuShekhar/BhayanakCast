import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { ChatService, CHAT_HISTORY_LIMIT } from '../../src/server/rooms/chat-service'
import { RoomService } from '../../src/server/rooms/room-service'
import { StreamService } from '../../src/server/streams/stream-service'
import { SubscriptionService } from '../../src/server/streams/subscription-service'
import { bindReportRuntime, submitReport } from '../../src/server/moderation/report-service'
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
    application_name: `room-services-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const clock = new TestClock(1_000_000)
  const now = () => new Date(clock.now())
  const rooms = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room-services:`,
    now,
    revokeConnections: () => undefined,
  })
  const changedRoomIds: string[] = []
  const account = async (name: string) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, image, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, false, $5, $5)',
      [id, name, `https://cdn.test/${id}.png`, `${id}@example.test`, now()],
    )
    return id
  }
  bindReportRuntime({ pool })
  fixtures.push(async () => {
    await Promise.all([pool.end(), valkey.quit()])
  })
  return {
    pool,
    clock,
    rooms,
    account,
    changedRoomIds,
    chat: new ChatService({ pool, now }),
    streams: new StreamService({
      pool,
      now,
      onRoomChanged: (roomId) => {
        changedRoomIds.push(roomId)
      },
    }),
    subscriptions: new SubscriptionService(pool, now),
  }
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}

async function joined(rooms: RoomService, accountId: string, roomId: string) {
  const result = await rooms.admit(accountId, roomId)
  expect(result.status).toBe('joined')
  if (result.status !== 'joined') throw new Error(`Expected joined, got ${result.status}`)
  return result.membership
}

async function startStream(
  streams: StreamService,
  accountId: string,
  roomId: string,
): Promise<string> {
  const result = await streams.start(accountId, roomId)
  expect(result.status).toBe('started')
  if (result.status !== 'started') throw new Error(`Expected started, got ${result.status}`)
  return result.streamId
}

describe('chat persistence', () => {
  test('persists a sent message and reads it back through the backfill', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Chat room' }))

    const sent = await fixture.chat.send(host, { roomId: room.room.id, body: '  hi   ' })
    expect(sent).toMatchObject({ status: 'sent', message: { body: 'hi', accountId: host } })

    const history = await fixture.chat.history(room.room.id, host)
    expect(history).toMatchObject([{ body: 'hi', displayName: 'Hana' }])
    expect(history[0]?.avatarUrl).toMatch(/^https:\/\/cdn\.test\//)
  })

  test('backfills the newest fifty messages in reading order', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Busy room' }))

    for (let index = 0; index < CHAT_HISTORY_LIMIT + 5; index += 1) {
      fixture.clock.advanceTo(fixture.clock.now() + 1_000)
      expect(
        (await fixture.chat.send(host, { roomId: room.room.id, body: `message ${index}` }))
          .status,
      ).toBe('sent')
    }

    const history = await fixture.chat.history(room.room.id, host)
    expect(history).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(history[0]?.body).toBe('message 5')
    expect(history.at(-1)?.body).toBe(`message ${CHAT_HISTORY_LIMIT + 4}`)
  })

  test('a muted author is filtered out for the muting viewer only', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const loud = await fixture.account('Lou')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Muting room' }))
    await joined(fixture.rooms, loud, room.room.id)

    expect(
      (await fixture.chat.send(host, { roomId: room.room.id, body: 'from host' })).status,
    ).toBe('sent')
    fixture.clock.advanceTo(fixture.clock.now() + 1_000)
    expect(
      (await fixture.chat.send(loud, { roomId: room.room.id, body: 'from lou' })).status,
    ).toBe('sent')
    await fixture.pool.query(
      'INSERT INTO chat_mute (muting_account_id, muted_account_id) VALUES ($1, $2)',
      [host, loud],
    )

    expect(
      (await fixture.chat.history(room.room.id, host)).map((message) => message.body),
    ).toEqual(['from host'])
    expect(
      (await fixture.chat.history(room.room.id, loud)).map((message) => message.body),
    ).toEqual(['from host', 'from lou'])
    expect(await fixture.chat.mutedAccountIds(host)).toEqual([loud])
  })

  test('refuses a sender who is not admitted and a room that has ended', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const outsider = await fixture.account('Otto')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Closing room' }))

    await expect(
      fixture.chat.send(outsider, { roomId: room.room.id, body: 'let me in' }),
    ).resolves.toEqual({ status: 'not-admitted' })

    await fixture.pool.query('UPDATE room SET ended_at = $2 WHERE id = $1', [
      room.room.id,
      new Date(fixture.clock.now()),
    ])
    await expect(
      fixture.chat.send(host, { roomId: room.room.id, body: 'anyone there' }),
    ).resolves.toEqual({ status: 'room-ended' })
    expect(await fixture.chat.history(room.room.id, host)).toEqual([])
  })
})

describe('stream lifecycle', () => {
  test('starts once per membership and stops the owner’s own stream', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Stream room' }))

    const streamId = await startStream(fixture.streams, host, room.room.id)
    await expect(fixture.streams.start(host, room.room.id)).resolves.toEqual({
      status: 'already-streaming',
      streamId,
    })

    await expect(fixture.streams.stop(host)).resolves.toMatchObject({
      status: 'stopped',
      streamId,
      endedSubscriptionIds: [],
    })
    await expect(fixture.streams.stop(host)).resolves.toEqual({ status: 'not-streaming' })
    expect(fixture.changedRoomIds).toEqual([room.room.id, room.room.id])
  })

  test('stopping a stream closes the subscriptions watching it', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const watcher = await fixture.account('Wren')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Watched room' }))
    const watcherMembership = await joined(fixture.rooms, watcher, room.room.id)

    const streamId = await startStream(fixture.streams, host, room.room.id)
    const subscribed = await fixture.subscriptions.subscribe(watcherMembership.id, streamId)
    expect(subscribed.status).toBe('subscribed')
    if (subscribed.status !== 'subscribed') throw new Error('Expected a subscription')

    await expect(fixture.streams.stop(host)).resolves.toMatchObject({
      status: 'stopped',
      endedSubscriptionIds: [subscribed.id],
    })
    expect(await fixture.subscriptions.current(watcherMembership.id)).toBeNull()
  })

  test('only the Host may stop another member’s stream', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const streamer = await fixture.account('Sam')
    const bystander = await fixture.account('Bo')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Moderated room' }))
    await joined(fixture.rooms, streamer, room.room.id)
    await joined(fixture.rooms, bystander, room.room.id)

    const streamId = await startStream(fixture.streams, streamer, room.room.id)
    await expect(fixture.streams.stop(bystander, { streamId })).resolves.toEqual({
      status: 'not-authorized',
    })
    await expect(fixture.streams.stop(host, { streamId })).resolves.toMatchObject({
      status: 'stopped',
      streamId,
    })
  })

  test('refuses to start outside a membership, and ends a room past its lifetime', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const outsider = await fixture.account('Otto')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Expiring room' }))

    await expect(fixture.streams.start(outsider, room.room.id)).resolves.toEqual({
      status: 'not-admitted',
    })

    // Past the room lifetime the start ends the room instead of publishing.
    fixture.clock.advanceTo(fixture.clock.now() + 13 * 60 * 60 * 1_000)
    await expect(fixture.streams.start(host, room.room.id)).resolves.toEqual({
      status: 'room-ended',
    })
    const ended = await fixture.pool.query('SELECT ended_at FROM room WHERE id = $1', [
      room.room.id,
    ])
    expect(ended.rows[0]?.ended_at).not.toBeNull()
  })

  test('stopForMembership ends every stream a departing membership owns', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const watcher = await fixture.account('Wren')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Departure room' }))
    const watcherMembership = await joined(fixture.rooms, watcher, room.room.id)

    const streamId = await startStream(fixture.streams, host, room.room.id)
    expect(
      (await fixture.subscriptions.subscribe(watcherMembership.id, streamId)).status,
    ).toBe('subscribed')

    expect(await fixture.streams.stopForMembership(room.membership.id)).toEqual([streamId])
    expect(await fixture.subscriptions.current(watcherMembership.id)).toBeNull()
    expect(await fixture.streams.stopForMembership(room.membership.id)).toEqual([])
  })
})

describe('subscription authorization', () => {
  test('names the two accounts of a live subscription and nobody else', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const watcher = await fixture.account('Wren')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Signaling room' }))
    const watcherMembership = await joined(fixture.rooms, watcher, room.room.id)

    const streamId = await startStream(fixture.streams, host, room.room.id)
    const subscribed = await fixture.subscriptions.subscribe(watcherMembership.id, streamId)
    if (subscribed.status !== 'subscribed') throw new Error('Expected a subscription')

    await expect(fixture.subscriptions.parties(subscribed.id)).resolves.toEqual({
      roomId: room.room.id,
      streamId,
      viewerAccountId: watcher,
      publisherAccountId: host,
    })
    // ADR 0104: an identifier nobody holds authorizes nothing.
    expect(await fixture.subscriptions.parties(randomUUID())).toBeNull()

    await fixture.subscriptions.unsubscribe(watcherMembership.id)
    expect(await fixture.subscriptions.parties(subscribed.id)).toBeNull()
  })

  test('withdraws authorization when the stream stops or the viewer leaves', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const watcher = await fixture.account('Wren')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Withdrawal room' }))
    const watcherMembership = await joined(fixture.rooms, watcher, room.room.id)
    const streamId = await startStream(fixture.streams, host, room.room.id)
    const first = await fixture.subscriptions.subscribe(watcherMembership.id, streamId)
    if (first.status !== 'subscribed') throw new Error('Expected a subscription')

    await fixture.streams.stop(host)
    expect(await fixture.subscriptions.parties(first.id)).toBeNull()

    const second = await startStream(fixture.streams, host, room.room.id)
    const resubscribed = await fixture.subscriptions.subscribe(watcherMembership.id, second)
    if (resubscribed.status !== 'subscribed') throw new Error('Expected a subscription')
    await fixture.pool.query('UPDATE room_membership SET left_at = $2 WHERE id = $1', [
      watcherMembership.id,
      new Date(fixture.clock.now()),
    ])
    expect(await fixture.subscriptions.parties(resubscribed.id)).toBeNull()
  })

  test('refuses a stream in another room, and the viewer’s own stream', async () => {
    const fixture = await createFixture()
    const host = await fixture.account('Hana')
    const elsewhere = await fixture.account('Eli')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Home room' }))
    const other = created(await fixture.rooms.createRoom(elsewhere, { name: 'Other room' }))

    const ownStream = await startStream(fixture.streams, host, room.room.id)
    const foreignStream = await startStream(fixture.streams, elsewhere, other.room.id)

    await expect(
      fixture.subscriptions.subscribe(room.membership.id, foreignStream),
    ).resolves.toEqual({ status: 'stream-unavailable' })
    await expect(
      fixture.subscriptions.subscribe(room.membership.id, ownStream),
    ).resolves.toEqual({ status: 'own-stream' })
  })
})

describe('report intake', () => {
  test('stores a structured report against the reported room', async () => {
    const fixture = await createFixture()
    const reporter = await fixture.account('Rae')
    const host = await fixture.account('Hana')
    const room = created(await fixture.rooms.createRoom(host, { name: 'Reported room' }))
    const streamId = await startStream(fixture.streams, host, room.room.id)

    await expect(
      submitReport(
        reporter,
        {
          targetType: 'stream',
          targetId: streamId,
          roomId: room.room.id,
          reason: 'harassment',
          details: '  targeted abuse  ',
        },
        new Date(fixture.clock.now()),
      ),
    ).resolves.toEqual({ status: 'received' })

    const stored = await fixture.pool.query(
      `SELECT reporter_account_id AS "reporterAccountId",
              target_type AS "targetType",
              target_id AS "targetId",
              room_id AS "roomId",
              reason,
              details
         FROM report WHERE reporter_account_id = $1`,
      [reporter],
    )
    expect(stored.rows).toEqual([
      {
        reporterAccountId: reporter,
        targetType: 'stream',
        targetId: streamId,
        roomId: room.room.id,
        reason: 'harassment',
        details: 'targeted abuse',
      },
    ])
  })

  test('rejects `other` without details before touching the table', async () => {
    const fixture = await createFixture()
    const reporter = await fixture.account('Rae')

    await expect(
      submitReport(reporter, {
        targetType: 'account',
        targetId: reporter,
        roomId: null,
        reason: 'other',
        details: '   ',
      }),
    ).resolves.toEqual({ status: 'details-required' })
    const stored = await fixture.pool.query(
      'SELECT id FROM report WHERE reporter_account_id = $1',
      [reporter],
    )
    expect(stored.rows).toEqual([])
  })
})
