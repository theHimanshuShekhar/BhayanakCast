import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import Redis from 'ioredis'
import { RoomService } from '../../src/server/rooms/room-service'
import { Pool } from 'pg'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { createDeletionService } from '../../src/server/profile/deletion-service'
import { createPreferenceService } from '../../src/server/profile/preference-service'
import { createPoolHomeQueryExecutor, HomeRepository } from '../../src/server/home/home-repository'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

async function fixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `account-deletion-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)
  const accountId = randomUUID()
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Deletion account', $2, false, now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  return { pool, accountId }
}

describe('account deletion requests', () => {
  test('submit and cancel are idempotent and keep a private audit trail', async () => {
    const { pool, accountId } = await fixture()
    const service = createDeletionService(pool)

    const submitted = await service.submit(accountId)
    expect(submitted.status).toBe('pending')
    expect(await service.submit(accountId)).toMatchObject({
      status: 'pending',
      requestId: submitted.requestId,
    })
    expect(await pool.query(
      'SELECT deletion_requested_at FROM account_state WHERE account_id = $1',
      [accountId],
    )).toMatchObject({ rows: [{ deletion_requested_at: expect.any(Date) }] })

    expect(await service.cancel(accountId)).toMatchObject({ status: 'cancelled' })
    expect(await service.cancel(accountId)).toMatchObject({ status: 'cancelled' })
    expect(await service.current(accountId)).toMatchObject({ status: 'cancelled' })
    expect(await pool.query(
      'SELECT event FROM deletion_request_audit WHERE account_id = $1 ORDER BY created_at',
      [accountId],
    )).toMatchObject({ rows: [{ event: 'submitted' }, { event: 'submitted' }, { event: 'cancelled' }, { event: 'cancelled' }] })
  })

  test('submission uses room lifecycle departure and host handoff', async () => {
    const { pool, accountId } = await fixture()
    const context = await getIntegrationContext()
    const valkey = new Redis(context.environment.valkeyUrl, {
      lazyConnect: true,
      keyPrefix: '',
      maxRetriesPerRequest: 1,
    })
    await valkey.connect()
    try {
      const otherAccountId = randomUUID()
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, 'Other account', $2, false, now(), now())`,
        [otherAccountId, `${otherAccountId}@example.test`],
      )
      const roomService = new RoomService({
        pool,
        valkey,
        valkeyPrefix: `${context.environment.valkeyPrefix}deletion:`,
        revokeConnections: () => undefined,
      })
      const room = await roomService.createRoom(accountId, { name: 'Deletion room' })
      expect(room.status).toBe('created')
      if (room.status !== 'created') throw new Error('Expected room creation')
      expect(await roomService.admit(otherAccountId, room.room.id)).toMatchObject({
        status: 'joined',
      })
      const deletion = createDeletionService(pool, { roomService })
      await deletion.submit(accountId)
      await expect(roomService.currentMembership(accountId)).resolves.toBeNull()
      await expect(roomService.currentMembership(otherAccountId)).resolves.toMatchObject({
        role: 'host',
      })
    } finally {
      await valkey.quit()
    }
  })
  test('rolls back the request when lifecycle departure fails', async () => {
    const { pool, accountId } = await fixture()
    const failingRoomService = {
      setDeletionPendingInTransaction: async () => {
        throw new Error('departure failed')
      },
    }
    const service = createDeletionService(pool, {
      roomService: failingRoomService as never,
    })

    await expect(service.submit(accountId)).rejects.toThrow('departure failed')
    await expect(
      pool.query('SELECT 1 FROM deletion_request WHERE account_id = $1', [accountId]),
    ).resolves.toMatchObject({ rows: [] })
    await expect(
      pool.query('SELECT 1 FROM account_state WHERE account_id = $1', [accountId]),
    ).resolves.toMatchObject({ rows: [] })
  })
  test('approval revokes sessions and cannot be cancelled', async () => {
    const { pool, accountId } = await fixture()
    const service = createDeletionService(pool)
    await pool.query(
      `INSERT INTO session (id, expires_at, token, user_id, created_at, updated_at)
       VALUES ($1, now() + interval '1 day', $2, $3, now(), now())`,
      [randomUUID(), randomUUID(), accountId],
    )
    await service.submit(accountId)
    await expect(service.respond(accountId, 'approved')).resolves.toMatchObject({
      status: 'approved',
    })
    await expect(service.cancel(accountId)).resolves.toMatchObject({ status: 'approved' })
    await expect(pool.query('SELECT 1 FROM session WHERE user_id = $1', [accountId])).resolves.toMatchObject({ rows: [] })
  })
  test('returns the resubmitted pending request when commands share a clock instant', async () => {
    const { pool, accountId } = await fixture()
    const instant = new Date('2026-07-18T00:00:00.000Z')
    const service = createDeletionService(pool, { now: () => instant })
    const forcedOldRequestId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    await pool.query(
      `INSERT INTO deletion_request
         (id, account_id, status, requested_at, resolved_at)
       VALUES ($1, $2, 'cancelled', $3, $3)`,
      [forcedOldRequestId, accountId, instant],
    )
    await pool.query(
      `INSERT INTO deletion_request_audit
         (id, request_id, account_id, event, created_at)
       VALUES ($1, $2, $3, 'cancelled', $4)`,
      [randomUUID(), forcedOldRequestId, accountId, instant],
    )
    const resubmitted = await service.submit(accountId)
    await expect(service.current(accountId)).resolves.toMatchObject({
      requestId: resubmitted.requestId,
      status: 'pending',
    })
  })
  test('rejects deletion when lifecycle is unavailable and membership is active', async () => {
    const { pool, accountId } = await fixture()
    const roomId = randomUUID()
    const membershipId = randomUUID()
    await pool.query(
      `INSERT INTO room
         (id, name, category, tags, visibility, password_hash, created_at, ended_at)
       VALUES ($1, 'Protected room', 'Film', ARRAY[]::text[], 'public', NULL, now(), NULL)`,
      [roomId],
    )
    await pool.query(
      `INSERT INTO room_membership
         (id, room_id, account_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'member', now(), NULL)`,
      [membershipId, roomId, accountId],
    )

    try {
      await expect(createDeletionService(pool).submit(accountId)).rejects.toThrow(
        'Room lifecycle service is required for active membership',
      )
      await expect(
        pool.query('SELECT 1 FROM deletion_request WHERE account_id = $1', [accountId]),
      ).resolves.toMatchObject({ rows: [] })
      await expect(
        pool.query('SELECT 1 FROM account_state WHERE account_id = $1', [accountId]),
      ).resolves.toMatchObject({ rows: [] })
      await expect(
        pool.query(
          'SELECT left_at FROM room_membership WHERE id = $1',
          [membershipId],
        ),
      ).resolves.toMatchObject({ rows: [{ left_at: null }] })
    } finally {
      await pool.query('DELETE FROM room_membership WHERE id = $1', [membershipId])
      await pool.query('DELETE FROM room WHERE id = $1', [roomId])
    }
  })
  test('external rejection restores the public profile projection', async () => {
    const { pool, accountId } = await fixture()
    const service = createDeletionService(pool)
    const profiles = new HomeRepository(createPoolHomeQueryExecutor(pool))

    await service.submit(accountId)
    await expect(profiles.publicProfile(accountId)).resolves.toBeNull()

    await expect(service.respond(accountId, 'rejected')).resolves.toMatchObject({
      status: 'rejected',
    })
    await expect(profiles.publicProfile(accountId)).resolves.toMatchObject({
      accountId,
      displayName: 'Deletion account',
    })
    await expect(
      pool.query(
        'SELECT deletion_requested_at FROM account_state WHERE account_id = $1',
        [accountId],
      ),
    ).resolves.toMatchObject({ rows: [{ deletion_requested_at: null }] })
  })

  test('serializes protected writes behind submission and denies them after pending', async () => {
    const { pool, accountId } = await fixture()
    const context = await getIntegrationContext()
    const protectedApplicationName = `account-deletion-protected-${randomUUID()}`
    const protectedPool = new Pool({
      connectionString: context.environment.databaseUrl,
      application_name: protectedApplicationName,
      options: `-c search_path=${context.environment.schema},public`,
    })
    pools.push(protectedPool)
    let releaseLifecycle!: () => void
    let lifecycleStarted!: () => void
    const lifecycleHeld = new Promise<void>((resolve) => {
      releaseLifecycle = resolve
    })
    const lifecycleReady = new Promise<void>((resolve) => {
      lifecycleStarted = resolve
    })
    const deletion = createDeletionService(pool, {
      roomService: {
        setDeletionPending: async () => undefined,
        setDeletionPendingInTransaction: async () => {
          lifecycleStarted()
          await lifecycleHeld
        },
      },
    })
    const preferences = createPreferenceService(protectedPool)

    const submission = deletion.submit(accountId)
    await lifecycleReady
    const protectedWrite = preferences.setTheme(accountId, 'dark')
    await waitForBlockedAccountLock(pool, protectedApplicationName)

    releaseLifecycle()
    await expect(submission).resolves.toMatchObject({ status: 'pending' })
    await expect(protectedWrite).rejects.toMatchObject({
      code: 'ACCOUNT_ACCESS_DENIED',
      mutation: 'theme',
      state: 'pending',
    })
    await expect(
      protectedPool.query('SELECT 1 FROM account_preference WHERE account_id = $1', [accountId]),
    ).resolves.toMatchObject({ rows: [] })
  })
})


async function waitForBlockedAccountLock(pool: Pool, applicationName: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const result = await pool.query(
      `SELECT 1
         FROM pg_stat_activity
        WHERE application_name = $1
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FOR UPDATE%'`,
      [applicationName],
    )
    if (result.rows[0]) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Protected write did not block on the account row')
}