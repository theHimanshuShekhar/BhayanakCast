import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { consumeFixedWindow } from '../../src/server/rate-limits/fixed-window'
import {
  consumePrivatePasswordLimit,
  consumeRoomCreationLimit,
} from '../../src/server/rate-limits/room-limits'
import { RoomService } from '../../src/server/rooms/room-service'
import { getIntegrationContext } from '../setup/integration'

let redis: Redis
let prefix: string
let pool: Pool

beforeAll(async () => {
  const context = await getIntegrationContext()
  prefix = `${context.environment.valkeyPrefix}room-rate-limits:`
  pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-rate-limits-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  redis = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await redis.connect()
})

afterEach(async () => {
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`)
    cursor = next
    if (keys.length > 0) await redis.del(...keys)
  } while (cursor !== '0')
})

afterAll(async () => {
  if (redis) await redis.quit()
  if (pool) await pool.end()
})

describe('room rate limits', () => {
  test('enforces the fixed-window boundary exactly and resets after Valkey expiry', async () => {
    const key = 'fixed-boundary'

    await expect(consumeFixedWindow(redis, prefix, key, 2, 60)).resolves.toEqual({
      kind: 'allowed',
      remaining: 1,
    })
    await expect(consumeFixedWindow(redis, prefix, key, 2, 60)).resolves.toEqual({
      kind: 'allowed',
      remaining: 0,
    })
    await expect(consumeFixedWindow(redis, prefix, key, 2, 60)).resolves.toEqual(
      expect.objectContaining({ kind: 'limited' }),
    )

    await redis.expire(`${prefix}${key}`, 0)

    await expect(consumeFixedWindow(redis, prefix, key, 2, 60)).resolves.toEqual({
      kind: 'allowed',
      remaining: 1,
    })
  })

  test('scopes room creation to each account', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        consumeRoomCreationLimit(redis, prefix, 'account-a'),
      ).resolves.toEqual({ kind: 'allowed', remaining: 5 - attempt })
    }

    await expect(
      consumeRoomCreationLimit(redis, prefix, 'account-a'),
    ).resolves.toEqual(expect.objectContaining({ kind: 'limited' }))
    await expect(
      consumeRoomCreationLimit(redis, prefix, 'account-b'),
    ).resolves.toEqual({ kind: 'allowed', remaining: 4 })
    const ttl = await redis.ttl(`${prefix}room-creation:account-a`)
    expect(ttl).toBeGreaterThanOrEqual(3_599)
    expect(ttl).toBeLessThanOrEqual(3_600)
  })

  test('scopes private-password attempts to account, room, and client IP', async () => {
    const attempt = () =>
      consumePrivatePasswordLimit(redis, prefix, {
        accountId: 'account-a',
        roomId: 'room-a',
        clientIp: '203.0.113.7',
      })

    for (let number = 1; number <= 10; number += 1) {
      await expect(attempt()).resolves.toEqual({
        kind: 'allowed',
        remaining: 10 - number,
      })
    }

    await expect(attempt()).resolves.toEqual(
      expect.objectContaining({ kind: 'limited' }),
    )
    await expect(
      consumePrivatePasswordLimit(redis, prefix, {
        accountId: 'account-b',
        roomId: 'room-a',
        clientIp: '203.0.113.7',
      }),
    ).resolves.toEqual({ kind: 'allowed', remaining: 9 })
    await expect(
      consumePrivatePasswordLimit(redis, prefix, {
        accountId: 'account-a',
        roomId: 'room-b',
        clientIp: '203.0.113.7',
      }),
    ).resolves.toEqual({ kind: 'allowed', remaining: 9 })
    await expect(
      consumePrivatePasswordLimit(redis, prefix, {
        accountId: 'account-a',
        roomId: 'room-a',
        clientIp: '203.0.113.8',
      }),
    ).resolves.toEqual({ kind: 'allowed', remaining: 9 })

    const [, keys] = await redis.scan('0', 'MATCH', `${prefix}*`)
    expect(keys.join('\n')).not.toContain('203.0.113.')
    const passwordKeys = keys.filter((key) =>
      key.includes('private-password:account-a:room-a:'),
    )
    const ttls = await Promise.all(passwordKeys.map((key) => redis.ttl(key)))
    expect(ttls.every((ttl) => ttl >= 599 && ttl <= 600)).toBe(true)
  })

  test('fails closed when Valkey is unavailable', async () => {
    const unavailable = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    })
    try {
      await expect(
        consumeFixedWindow(unavailable, prefix, 'unavailable', 1, 60),
      ).resolves.toEqual({ kind: 'unavailable' })
      const [owner, candidate] = [randomUUID(), randomUUID()]
      await pool.query(
        `INSERT INTO "user"
           (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, 'Owner', $3, false, now(), now()),
                ($2, 'Candidate', $4, false, now(), now())`,
        [owner, candidate, `${owner}@example.test`, `${candidate}@example.test`],
      )
      const workingService = new RoomService({
        pool,
        valkey: redis,
        valkeyPrefix: prefix,
        revokeConnections: () => undefined,
      })
      const privateRoom = await workingService.createRoom(owner, {
        name: 'Private target',
        visibility: 'private',
        password: 'correct horse',
      })
      if (privateRoom.status !== 'created') {
        throw new Error('Expected private room creation')
      }
      const unavailableService = new RoomService({
        pool,
        valkey: unavailable,
        valkeyPrefix: prefix,
        revokeConnections: () => undefined,
      })
      await expect(
        unavailableService.createRoom(candidate, { name: 'Must not persist' }),
      ).resolves.toEqual({ status: 'rate-limit-unavailable' })
      await expect(
        unavailableService.admit(candidate, privateRoom.room.id, {
          password: 'correct horse',
          clientIp: '203.0.113.20',
        }),
      ).resolves.toEqual({ status: 'rate-limit-unavailable' })
      await expect(
        unavailableService.currentMembership(candidate),
      ).resolves.toBeNull()
      const persisted = await pool.query(
        'SELECT 1 FROM room WHERE created_by = $1',
        [candidate],
      )
      expect(persisted.rows).toHaveLength(0)
    } finally {
      unavailable.disconnect()
    }
  })
})
