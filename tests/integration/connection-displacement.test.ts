import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import {
  HOME_ACCOUNT_REPLACED_EVENT,
  HOME_SOCKET_EVENT,
} from '../../src/server/realtime/home-events'
import { ConnectionRegistry, type RegisteredConnection } from '../../src/server/realtime/connection-registry'
import { RoomService } from '../../src/server/rooms/room-service'
import { createTestAccountHarness, type TestAccountHarness } from '../helpers/test-account'
import { getIntegrationContext } from '../setup/integration'

let accountHarness: TestAccountHarness | undefined

let nextDiscordId = 0
async function openProductionSocket(
  cookie: string,
  origin: string,
  onCreated?: (socket: Socket) => void,
) {
  const socket = io(origin, {
    path: '/socket.io/',
    transports: ['websocket'],
    withCredentials: true,
    extraHeaders: { cookie },
  })
  onCreated?.(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

async function waitForProduction<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  let last: T | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    last = await read()
    if (predicate(last)) return last
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for production socket state: ${JSON.stringify(last)}`)
}
async function productionRoom() {
  const context = await getIntegrationContext()
  accountHarness ??= await createTestAccountHarness(context)
  const signedIn = await accountHarness.signInDiscord({
    username: 'socket-test',
    id: String(10_000_000_000_000_000n + BigInt(++nextDiscordId)),
    verified: true,
  })
  const session = await accountHarness.readProjectedSession(signedIn.sessionCookie)
  if (!session) throw new Error('Expected authenticated account')
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `socket-displacement-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    keyPrefix: '',
    maxRetriesPerRequest: 1,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  await valkey.connect()
  const service = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}socket-displacement:`,
    revokeConnections: () => undefined,
  })
  let created = await service.createRoom(session.id, {
    name: `Socket room ${randomUUID().slice(0, 8)}`,
  })
  if (created.status === 'confirmation-required') {
    created = await service.createRoom(
      session.id,
      { name: `Socket room ${randomUUID().slice(0, 8)}` },
      { confirmation: created.confirmation },
    )
  }
  if (created.status !== 'created') throw new Error(`Expected room creation, got ${created.status}`)
  const cleanup = async () => {
    await pool.query(
      `DELETE FROM stream_subscription
        WHERE viewer_membership_id IN (
          SELECT id FROM room_membership WHERE room_id = $1
        )
           OR stream_id IN (
          SELECT id FROM stream WHERE room_id = $1
        )`,
      [created.room.id],
    )
    await pool.query('DELETE FROM stream WHERE room_id = $1', [created.room.id])
    await pool.query('DELETE FROM room_ban WHERE room_id = $1', [created.room.id])
    await pool.query('DELETE FROM room_membership WHERE room_id = $1', [created.room.id])
    await pool.query('DELETE FROM room WHERE id = $1', [created.room.id])
    await Promise.all([pool.end(), valkey.quit()])
  }
  return {
    context,
    pool,
    valkey,
    roomId: created.room.id,
    accountId: session.id,
    cookie: signedIn.sessionCookie,
    cleanup,
  }
}

afterAll(async () => {
  await accountHarness?.cleanup()
})

function socket(label: string) {
  const calls: string[] = []
  const value: RegisteredConnection = {
    emit(event) {
      calls.push(`${label}:emit:${event}`)
    },
    disconnect() {
      calls.push(`${label}:disconnect`)
    },
  }
  return { value, calls }
}

describe('account connection displacement', () => {
  test('emits one terminal event before disconnecting the displaced socket', () => {
    const registry = new ConnectionRegistry()
    const first = socket('first')
    const second = socket('second')

    registry.register('account-1', first.value)
    registry.register('account-1', second.value)

    expect(first.calls).toEqual([
      `first:emit:${HOME_ACCOUNT_REPLACED_EVENT}`,
      'first:disconnect',
    ])
    expect(second.calls).toEqual([])
    expect(registry.current('account-1')).toBe(second.value)
  })

  test('an old disconnect cannot remove a replacement connection', () => {
    const registry = new ConnectionRegistry()
    const first = socket('first')
    const second = socket('second')

    registry.register('account-1', first.value)
    registry.register('account-1', second.value)
    registry.remove('account-1', first.value)

    expect(registry.current('account-1')).toBe(second.value)
  })

  test('removes only the currently registered socket', () => {
    const registry = new ConnectionRegistry()
    const connection = socket('only')

    registry.register('account-1', connection.value)
    registry.remove('account-1', connection.value)

    expect(registry.current('account-1')).toBeNull()
  })
})

describe('production account connection lifecycle', () => {
  test('reconnect reclaim is serialized with the prior socket disconnect', async () => {
    const fixture = await productionRoom()
    try {
      const first = await openProductionSocket(fixture.cookie, fixture.context.server.origin)
      let secondPromise!: Promise<Socket>
      const reclaimed = new Promise<void>((resolve) => {
        secondPromise = openProductionSocket(
          fixture.cookie,
          fixture.context.server.origin,
          (socket) => {
            socket.on(HOME_SOCKET_EVENT, (event: unknown) => {
              if (
                event &&
                typeof event === 'object' &&
                'type' in event &&
                event.type === 'room-membership' &&
                'roomId' in event &&
                event.roomId === fixture.roomId
              ) {
                resolve()
              }
            })
          },
        )
      })
      first.disconnect()
      const second = await secondPromise
      await reclaimed
      const result = await fixture.pool.query<{
        leftAt: Date | null
        reconnectUntil: Date | null
      }>(
        'SELECT left_at AS "leftAt", reconnect_until AS "reconnectUntil" FROM room_membership WHERE room_id = $1 AND account_id = $2',
        [fixture.roomId, fixture.accountId],
      )
      const row = result.rows[0]
      expect(row).toMatchObject({ leftAt: null, reconnectUntil: null })
      second.disconnect()
    } finally {
      await fixture.cleanup()
    }
  })

  test('displacement emits one terminal event and leaves the old socket disconnected', async () => {
    const fixture = await productionRoom()
    try {
      const first = await openProductionSocket(fixture.cookie, fixture.context.server.origin)
      const replacements: unknown[] = []
      const replaced = new Promise<void>((resolve) => {
        first.once(HOME_ACCOUNT_REPLACED_EVENT, (event) => {
          replacements.push(event)
          resolve()
        })
      })
      const disconnected = new Promise<void>((resolve) => {
        first.once('disconnect', () => resolve())
      })
      const refreshes: unknown[] = []
      let secondPromise!: Promise<Socket>
      const refreshed = new Promise<void>((resolve) => {
        secondPromise = openProductionSocket(
          fixture.cookie,
          fixture.context.server.origin,
          (socket) => {
            socket.on(HOME_SOCKET_EVENT, (event: unknown) => {
              refreshes.push(event)
              if (
                event &&
                typeof event === 'object' &&
                'type' in event &&
                event.type === 'room-discovery' &&
                'roomId' in event &&
                event.roomId === fixture.roomId
              ) {
                resolve()
              }
            })
          },
        )
      })
      const second = await secondPromise
      await Promise.all([replaced, disconnected, refreshed])
      expect(replacements).toHaveLength(1)
      expect(refreshes).toContainEqual({
        type: 'room-discovery',
        roomId: fixture.roomId,
      })
      const row = await waitForProduction(
        () =>
          fixture.pool.query<{ leftAt: Date | null }>(
            'SELECT left_at AS "leftAt" FROM room_membership WHERE room_id = $1 AND account_id = $2',
            [fixture.roomId, fixture.accountId],
          ).then((result) => result.rows[0]),
        (value) => Boolean(value?.leftAt),
      )
      expect(row.leftAt).toBeInstanceOf(Date)
      second.disconnect()
    } finally {
      await fixture.cleanup()
    }
  })
})
