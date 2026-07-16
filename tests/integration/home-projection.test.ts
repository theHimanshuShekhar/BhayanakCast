import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import {
  createPoolHomeQueryExecutor,
  HomeRepository,
  type HomeQueryExecutor,
} from '../../src/server/home/home-repository'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

async function fixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `home-projection-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)
  const account = async (name: string, image: string | null = null) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, false, now(), now())',
      [id, name, `${id}@example.test`, image],
    )
    return id
  }
  const room = async (input: {
    name: string
    visibility: 'public' | 'private'
    endedAt?: Date | null
    createdAt?: Date
  }) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($8, $7, now()), $7)',
      [id, input.name, 'Film', ['classic'], input.visibility, input.visibility === 'private' ? 'hash' : null, input.endedAt ?? null, input.createdAt],
    )
    return id
  }
  const membership = async (roomId: string, accountId: string, left = false) => {
    const id = randomUUID()
    await pool.query(
      'INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at) VALUES ($1, $2, $3, $4, now(), CASE WHEN $5 THEN now() ELSE NULL END)',
      [id, roomId, accountId, 'member', left],
    )
    return id
  }
  return { pool, account, room, membership }
}

describe('Home PostgreSQL projections', () => {
  test('forwards a superseded request signal to the repository query boundary', async () => {
    const controller = new AbortController()
    let observed: AbortSignal | undefined
    const deferred = Promise.withResolvers<{ rows: [] }>()
    const repository = new HomeRepository({
      query: (_text, _values, signal) => {
        observed = signal
        signal?.addEventListener('abort', () => deferred.reject(signal.reason), { once: true })
        return deferred.promise
      },
    })

    const request = repository.activeRooms({}, controller.signal)
    controller.abort(new Error('superseded'))

    await expect(request).rejects.toThrow('superseded')
    expect(observed).toBe(controller.signal)
  })
  test('bounds previews and never projects participant identities from private rooms', async () => {
    const data = await fixture()
    const roomId = await data.room({ name: 'Private film club', visibility: 'private' })
    for (let index = 0; index < 5; index += 1) {
      const membershipId = await data.membership(roomId, await data.account(`Private ${index}`, `private-${index}`))
      await data.pool.query(
        'INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at) VALUES ($1, $2, $3, $4, now() + ($5 * interval \'1 minute\'), now())',
        [randomUUID(), roomId, membershipId, `preview-${index}`, index],
      )
    }

    const rooms = await new HomeRepository(createPoolHomeQueryExecutor(data.pool)).activeRooms({})
    expect(rooms).toHaveLength(1)
    expect(rooms[0]).toMatchObject({ id: roomId, memberCount: 5, streamCount: 5, visibility: 'private' })
    expect(rooms[0]?.previews).toHaveLength(4)
    expect(JSON.stringify(rooms[0])).not.toContain('Private 0')
    expect(JSON.stringify(rooms[0])).not.toContain('private-0')
  })

  test('bounds public avatar presence without exposing private-room avatars', async () => {
    const data = await fixture()
    const publicRoom = await data.room({ name: 'Public presence', visibility: 'public' })
    const privateRoom = await data.room({ name: 'Private presence', visibility: 'private' })
    for (let index = 0; index < 6; index += 1) {
      const accountId = await data.account(`Presence ${index}`, `avatar-${index}`)
      await data.membership(publicRoom, accountId)
    }
    await data.membership(
      privateRoom,
      await data.account('Private presence', 'private-avatar'),
    )

    const rooms = await new HomeRepository(
      createPoolHomeQueryExecutor(data.pool),
    ).activeRooms({})
    expect(rooms.find((room) => room.id === publicRoom)?.memberAvatars).toEqual([
      'avatar-0',
      'avatar-1',
      'avatar-2',
      'avatar-3',
    ])
    expect(rooms.find((room) => room.id === privateRoom)?.memberAvatars).toEqual([])
  })

  test('uses bounded grouped queries for profiles and ten newest past streams', async () => {
    const data = await fixture()
    const alice = await data.account('Alice', 'alice-avatar')
    const bob = await data.account('Bob', 'bob-avatar')
    for (let index = 0; index < 12; index += 1) {
      const endedAt = new Date(Date.UTC(2026, 6, 1, 0, 0, index))
      const roomId = await data.room({ name: `Alice Past ${index}`, visibility: 'public', endedAt })
      const membershipId = await data.membership(roomId, alice, true)
      const bobMembershipId = await data.membership(roomId, bob, true)
      await data.pool.query(
        'UPDATE room_membership SET joined_at = $2, left_at = $3 WHERE id = ANY($1)',
        [[membershipId, bobMembershipId], new Date(endedAt.getTime() - 60_000), endedAt],
      )
      await data.pool.query(
        'INSERT INTO stream (id, room_id, membership_id, started_at, ended_at) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), roomId, membershipId, endedAt, endedAt],
      )
    }

    const repository = new HomeRepository(createPoolHomeQueryExecutor(data.pool))
    const pastStreams = await repository.pastStreams()
    const profiles = await repository.profiles({ q: 'alice' })
    expect(pastStreams).toHaveLength(10)
    expect(pastStreams[0]?.endedAt > pastStreams[1]!.endedAt).toBe(true)
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ accountId: alice, displayName: 'Alice', avatarUrl: 'alice-avatar' })
    expect(profiles[0]?.pastStreams.length).toBeLessThanOrEqual(3)
    expect(profiles[0]?.coUsers).toEqual([{ accountId: bob, avatarUrl: 'bob-avatar' }])
    expect(JSON.stringify(profiles[0]?.coUsers)).not.toContain('Bob')
  })

  test('hides pending-deletion identities and live activity from profiles', async () => {
    const data = await fixture()
    const alice = await data.account('Visible Alice', 'alice-visible')
    const bob = await data.account('Hidden Bob', 'bob-hidden')
    const endedAt = new Date('2026-07-09T12:00:00.000Z')
    const historyRoom = await data.room({
      name: 'Finished history',
      visibility: 'private',
      endedAt,
    })
    const historicalMembership = await data.membership(historyRoom, alice, true)
    await data.membership(historyRoom, bob, true)
    await data.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at, ended_at) VALUES ($1, $2, $3, $4, $4)',
      [randomUUID(), historyRoom, historicalMembership, endedAt],
    )
    const liveRoom = await data.room({ name: 'Hidden live room', visibility: 'private' })
    const liveMembership = await data.membership(liveRoom, alice)
    await data.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, now())',
      [randomUUID(), liveRoom, liveMembership],
    )
    await data.pool.query(
      'INSERT INTO account_state (account_id, deletion_requested_at) VALUES ($1, now())',
      [bob],
    )

    const repository = new HomeRepository(createPoolHomeQueryExecutor(data.pool))
    await expect(repository.profiles({ q: 'Hidden Bob' })).resolves.toEqual([])
    const profiles = await repository.profiles({ q: 'Visible Alice' })
    expect(profiles[0]).toMatchObject({
      accountId: alice,
      roomCount: 1,
      streamCount: 1,
      coUsers: [],
    })
  })

  test('returns one public profile while treating absent and pending-deletion accounts as absent', async () => {
    const data = await fixture()
    const visible = await data.account('Visible profile', 'visible-avatar')
    const pending = await data.account('Pending profile', 'pending-avatar')
    await data.pool.query(
      'INSERT INTO account_state (account_id, deletion_requested_at) VALUES ($1, now())',
      [pending],
    )

    const repository = new HomeRepository(createPoolHomeQueryExecutor(data.pool))

    await expect(repository.publicProfile(visible)).resolves.toMatchObject({
      accountId: visible,
      displayName: 'Visible profile',
      avatarUrl: 'visible-avatar',
      roomCount: 0,
      streamCount: 0,
      pastStreams: [],
      coUsers: [],
    })
    await expect(repository.publicProfile(pending)).resolves.toBeNull()
    await expect(repository.publicProfile(randomUUID())).resolves.toBeNull()
  })

  test('excludes co-users whose membership intervals never overlapped', async () => {
    const data = await fixture()
    const alice = await data.account('Interval Alice')
    const bob = await data.account('Interval Bob')
    const endedAt = new Date('2026-07-10T03:00:00.000Z')
    const roomId = await data.room({
      name: 'Separate visits',
      visibility: 'public',
      endedAt,
    })
    await data.pool.query(
      `INSERT INTO room_membership
       (id, room_id, account_id, role, joined_at, left_at)
       VALUES
       ($1, $3, $4, 'member', $6, $7),
       ($2, $3, $5, 'member', $7, $8)`,
      [
        randomUUID(),
        randomUUID(),
        roomId,
        alice,
        bob,
        new Date('2026-07-10T01:00:00.000Z'),
        new Date('2026-07-10T02:00:00.000Z'),
        endedAt,
      ],
    )

    const profiles = await new HomeRepository(
      createPoolHomeQueryExecutor(data.pool),
    ).profiles({ q: 'Interval Alice' })
    expect(profiles[0]?.coUsers).toEqual([])
  })

  test('projects all global and operator-day database statistics', async () => {
    const data = await fixture()
    const repository = new HomeRepository(createPoolHomeQueryExecutor(data.pool))
    const before = await repository.statistics('2037-04-18')
    const accountId = await data.account('Statistics member')
    const roomId = await data.room({
      name: 'Statistics room',
      visibility: 'public',
      createdAt: new Date('2037-04-18T12:00:00.000Z'),
    })
    const membershipId = await data.membership(roomId, accountId)
    await data.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, now())',
      [randomUUID(), roomId, membershipId],
    )

    await expect(repository.statistics('2037-04-18')).resolves.toEqual({
      activeRoomCount: before.activeRoomCount + 1,
      activeStreamCount: before.activeStreamCount + 1,
      currentMembershipCount: before.currentMembershipCount + 1,
      roomsCreatedToday: 1,
    })
  })

  test('runs rich profile aggregates only for the twenty ranked identities', async () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      accountId: `account-${index.toString().padStart(2, '0')}`,
      displayName: `Match ${index.toString().padStart(2, '0')}`,
      avatarUrl: null,
    }))
    const aggregateValues: unknown[][] = []
    let queryCount = 0
    const database: HomeQueryExecutor = {
      async query<T>(text: string, values?: unknown[]) {
        queryCount += 1
        if (text.includes('SELECT account.id AS "accountId"')) {
          return { rows: candidates as T[] }
        }
        aggregateValues.push(values ?? [])
        return { rows: [] }
      },
    }

    await new HomeRepository(database).profiles({ q: 'Match' })

    expect(queryCount).toBe(2)
    expect(aggregateValues).toEqual([[candidates.slice(0, 20).map(({ accountId }) => accountId)]])
  })

  test('cancels PostgreSQL work when a Home query is aborted', async () => {
    const data = await fixture()
    const executor = createPoolHomeQueryExecutor(data.pool)
    const controller = new AbortController()
    const marker = `home-cancel-${randomUUID()}`
    const pending = executor.query(
      `SELECT pg_sleep(10) /* ${marker} */`,
      [],
      controller.signal,
    )

    await waitForQuery(data.pool, marker, true)
    controller.abort(new Error('superseded'))

    await expect(pending).rejects.toThrow('superseded')
    await waitForQuery(data.pool, marker, false)
  })
})

async function waitForQuery(pool: Pool, marker: string, active: boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
        WHERE state = 'active'
          AND query LIKE $1`,
      [`%${marker}%`],
    )
    if ((result.rows[0]?.count ?? 0) > 0 === active) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for query ${marker} active=${active}`)
}
