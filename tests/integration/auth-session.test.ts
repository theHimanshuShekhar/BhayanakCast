import { setTimeout as wait } from 'node:timers/promises'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { describe, expect, test } from 'vitest'
import { RoomService } from '../../src/server/rooms/room-service'
import { createTestAccountHarness } from '../helpers/test-account'
import { getIntegrationContext } from '../setup/integration'

const DAY_MS = 24 * 60 * 60 * 1_000
const SESSION_LIFETIME_MS = 7 * DAY_MS

async function createAccounts() {
  return createTestAccountHarness(await getIntegrationContext())
}

async function waitForDatabaseBlocks(
  pool: Pool,
  blockerPid: number,
  minimum: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const blocked = await pool.query<{ count: number }>(
      `WITH RECURSIVE blocked(pid) AS (
         SELECT activity.pid
           FROM pg_stat_activity activity
          WHERE $1 = ANY(pg_blocking_pids(activity.pid))
         UNION
         SELECT activity.pid
           FROM pg_stat_activity activity
           JOIN blocked blocker
             ON blocker.pid = ANY(pg_blocking_pids(activity.pid))
       )
       SELECT count(*)::int AS count FROM blocked`,
      [blockerPid],
    )
    if ((blocked.rows[0]?.count ?? 0) >= minimum) return
    await wait(10)
  }
  throw new Error(`Expected ${minimum} database operations to block`)
}

describe('Better Auth Discord sessions', () => {
  test('stores a seven-day session, refreshes it no more than daily, and writes no cached session cookie', async () => {
    const accounts = await createAccounts()
    try {
      const signedIn = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Member',
        avatar: 'avatar-hash',
        email: 'member@example.test',
        verified: true,
      })
      const createdAt = accounts.now()
      const initial = await accounts.inspectSession(signedIn.sessionCookie)

      expect(initial.expiresAt.getTime()).toBe(createdAt + SESSION_LIFETIME_MS)
      expect(signedIn.setCookieHeaders).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/session_data/i)]),
      )

      await accounts.advanceTimeBy(DAY_MS - 1)
      await accounts.readProjectedSession(signedIn.sessionCookie)
      expect(
        (await accounts.inspectSession(signedIn.sessionCookie)).expiresAt.getTime(),
      ).toBe(initial.expiresAt.getTime())

      await accounts.advanceTimeBy(2)
      await accounts.readProjectedSession(signedIn.sessionCookie)
      expect(
        (await accounts.inspectSession(signedIn.sessionCookie)).expiresAt.getTime(),
      ).toBe(accounts.now() + SESSION_LIFETIME_MS)
    } finally {
      await accounts.cleanup()
    }
  })

  test('refreshes stored Discord identity on sign-in without changing the opaque user id', async () => {
    const accounts = await createAccounts()
    try {
      const firstSignIn = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Before refresh',
        avatar: 'before-avatar',
        email: 'member@example.test',
        verified: true,
      })
      const firstSession = await accounts.readProjectedSession(
        firstSignIn.sessionCookie,
      )
      const secondSignIn = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'After refresh',
        avatar: 'after-avatar',
        email: 'member@example.test',
        verified: true,
      })

      expect(
        await accounts.readProjectedSession(secondSignIn.sessionCookie),
      ).toMatchObject({
        id: firstSession?.id,
        displayName: 'After refresh',
        avatar:
          'https://cdn.discordapp.com/avatars/102938475610293847/after-avatar.png',
      })
    } finally {
      await accounts.cleanup()
    }
  })

  test('removes projected access immediately after sign-out and explicit revocation', async () => {
    const accounts = await createAccounts()
    try {
      const signedIn = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Member',
        avatar: 'avatar-hash',
        email: 'member@example.test',
        verified: true,
      })

      expect(await accounts.readProjectedSession(signedIn.sessionCookie)).not.toBeNull()
      await accounts.signOut(signedIn.sessionCookie)
      expect(await accounts.readProjectedSession(signedIn.sessionCookie)).toBeNull()

      const signedInAgain = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Member',
        avatar: 'avatar-hash',
        email: 'member@example.test',
        verified: true,
      })
      await accounts.revokeSession(signedInAgain.sessionCookie)
      expect(
        await accounts.readProjectedSession(signedInAgain.sessionCookie),
      ).toBeNull()
    } finally {
      await accounts.cleanup()
    }
  })

  test('projects only the client-safe session fields', async () => {
    const accounts = await createAccounts()
    try {
      const signedIn = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Member',
        avatar: 'avatar-hash',
        email: 'member@example.test',
        verified: true,
      })
      const projected = await accounts.readProjectedSession(signedIn.sessionCookie)

      expect(projected).toEqual({
        id: expect.any(String),
        displayName: 'Member',
        avatar:
          'https://cdn.discordapp.com/avatars/102938475610293847/avatar-hash.png',
        isPlatformAdmin: false,
        expiresAt: expect.any(Date),
      })
    } finally {
      await accounts.cleanup()
    }
  })

  test('keeps independently created accounts and their real session cookies isolated', async () => {
    const accounts = await createAccounts()
    try {
      const first = await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'first',
        global_name: 'First member',
        avatar: 'first-avatar',
        email: 'first@example.test',
        verified: true,
      })
      const second = await accounts.signInDiscord({
        id: '918273645091827364',
        username: 'second',
        global_name: 'Second member',
        avatar: 'second-avatar',
        email: 'second@example.test',
        verified: true,
      })

      const firstSession = await accounts.readProjectedSession(first.sessionCookie)
      const secondSession = await accounts.readProjectedSession(second.sessionCookie)

      expect(first.sessionCookie).not.toBe(second.sessionCookie)
      expect(firstSession?.id).not.toBe(secondSession?.id)
      expect(firstSession).toMatchObject({ displayName: 'First member' })
      expect(secondSession).toMatchObject({ displayName: 'Second member' })
    } finally {
      await accounts.cleanup()
    }
  })

  test('stores authentication rate limits in the isolated PostgreSQL schema', async () => {
    const context = await getIntegrationContext()
    const accounts = await createTestAccountHarness(context)
    try {
      await accounts.signInDiscord({
        id: '102938475610293847',
        username: 'member',
        global_name: 'Rate limited member',
        avatar: 'avatar-hash',
        email: 'rate-limit@example.test',
        verified: true,
      })

      const { rows } = await context.environment.sql(
        'SELECT "key", count, last_request FROM rate_limit',
      )
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: expect.any(String),
            count: expect.any(Number),
            last_request: expect.any(String),
          }),
        ]),
      )
    } finally {
      await accounts.cleanup()
    }
  })

  test('rejects a real Discord sign-in racing an all-access sanction', async () => {
    const context = await getIntegrationContext()
    const accounts = await createTestAccountHarness(context)
    const pool = new Pool({
      connectionString: context.environment.databaseUrl,
      application_name: `sanction-sign-in-${context.workerId}`,
      options: `-c search_path=${context.environment.schema},public`,
    })
    const valkey = new Redis(context.environment.valkeyUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
    const blocker = await pool.connect()
    const profile = {
      id: '564738291056473829',
      username: 'sanction-race',
      global_name: 'Sanction race',
      avatar: 'sanction-avatar',
      email: 'sanction-race@example.test',
      verified: true,
    }
    try {
      const initial = await accounts.signInDiscord(profile)
      const projection = await accounts.readProjectedSession(initial.sessionCookie)
      if (!projection) throw new Error('Expected initial session')
      const service = new RoomService({
        pool,
        valkey,
        valkeyPrefix: `${context.environment.valkeyPrefix}sanction-sign-in:`,
        revokeConnections: () => undefined,
      })

      await blocker.query('BEGIN')
      await blocker.query('LOCK TABLE platform_sanction IN ACCESS EXCLUSIVE MODE')
      const backend = await blocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      const blockerPid = backend.rows[0]?.pid ?? -1
      const sanction = service.applySanction({
        accountId: projection.id,
        type: 'all_access',
      })
      await waitForDatabaseBlocks(pool, blockerPid, 1)
      const racingSignIn = accounts.signInDiscord(profile).then(
        (session) => ({ session }),
        (error: unknown) => ({ error }),
      )
      await waitForDatabaseBlocks(pool, blockerPid, 2)
      await blocker.query('COMMIT')
      await sanction
      const guard = await pool.query<{
        blockedUntil: Date | null
        blockedIndefinite: boolean
      }>(
        `SELECT all_access_blocked_until AS "blockedUntil",
                all_access_blocked_indefinite AS "blockedIndefinite"
           FROM "user"
          WHERE id = $1`,
        [projection.id],
      )
      expect(guard.rows[0]).toMatchObject({
        blockedUntil: expect.any(Date),
        blockedIndefinite: false,
      })
      const racedSignIn = await racingSignIn
      if ('session' in racedSignIn && racedSignIn.session) {
        await expect(
          accounts.readProjectedSession(racedSignIn.session.sessionCookie),
        ).resolves.toBeNull()
      }
      await expect(accounts.signInDiscord(profile)).rejects.toThrow()
      await expect(
        accounts.readProjectedSession(initial.sessionCookie),
      ).resolves.toBeNull()
      const sessions = await pool.query(
        'SELECT 1 FROM session WHERE user_id = $1',
        [projection.id],
      )
      expect(sessions.rows).toHaveLength(0)
      await pool.query(
        `UPDATE platform_sanction
            SET lifted_at = $2
          WHERE account_id = $1 AND lifted_at IS NULL`,
        [projection.id, new Date(accounts.now())],
      )
      await accounts.advanceTimeBy(60_000)
      const restored = await accounts.signInDiscord(profile)
      await expect(
        accounts.readProjectedSession(restored.sessionCookie),
      ).resolves.toMatchObject({ id: projection.id })
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
      valkey.disconnect()
      await pool.end()
      await accounts.cleanup()
    }
  })
})
