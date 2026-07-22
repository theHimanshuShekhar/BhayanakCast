import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterAll, afterEach, describe, expect, test } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { QueryClient } from '@tanstack/react-query'
import type { ActiveRoomSummary } from '../../src/features/home/home-types'
import {
  HOME_ACCOUNT_REPLACED_EVENT,
  HOME_SOCKET_EVENT,
  applyHomeRealtimeEvent,
  createHomeEventHub,
  normalizeHomeRealtimeEvent,
  type HomeRealtimeEvent,
} from '../../src/server/realtime/home-events'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService } from '../../src/server/rooms/room-service'
import { refreshHomeQueries } from '../../src/features/home/home-realtime'
import {
  createTestAccountHarness,
  type TestAccountHarness,
} from '../helpers/test-account'
import { getIntegrationContext } from '../setup/integration'

const sockets: Socket[] = []
let accounts: TestAccountHarness | undefined

const room = (id: string, memberCount = 2): ActiveRoomSummary => ({
  id,
  name: id,
  category: null,
  tags: [],
  visibility: 'public',
  memberCount,
  streamCount: 1,
  state: 'live',
  previews: [],
  memberAvatars: [],
})

function waitForSocketEvent(socket: Socket, event: string) {
  return new Promise<void>((resolve, reject) => {
    socket.once(event, () => resolve())
    socket.once('connect_error', (error) => reject(error))
  })
}
async function openSocket(cookie: string, origin: string) {
  const socket = io(origin, {
    path: '/socket.io/',
    transports: ['websocket'],
    withCredentials: true,
    extraHeaders: { cookie },
  })

  sockets.push(socket)
  await waitForSocketEvent(socket, 'connect')
  return socket
}

function waitForHomeEvent(
  socket: Socket,
  predicate: (event: HomeRealtimeEvent) => boolean,
) {
  return new Promise<HomeRealtimeEvent>((resolve, reject) => {
    const onEvent = (value: unknown) => {
      const event = normalizeHomeRealtimeEvent(value)
      if (!event || !predicate(event)) return
      socket.off(HOME_SOCKET_EVENT, onEvent)
      resolve(event)
    }
    socket.on(HOME_SOCKET_EVENT, onEvent)
    socket.once('connect_error', (error) => {
      socket.off(HOME_SOCKET_EVENT, onEvent)
      reject(error)
    })
  })
}

async function authHarness() {
  const context = await getIntegrationContext()
  accounts ??= await createTestAccountHarness(context)
  return { context, accounts }
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect()
})

  test('committed RoomService room creation publishes Home lifecycle events', async () => {
    const context = await getIntegrationContext()
    const pool = new Pool({
      connectionString: context.environment.databaseUrl,
      application_name: `home-realtime-producer-${context.workerId}`,
      options: `-c search_path=${context.environment.schema},public`,
    })
    const valkey = new Redis(context.environment.valkeyUrl, {
      lazyConnect: true,
      keyPrefix: '',
      maxRetriesPerRequest: 1,
    })
    try {
      await migrateAuthDatabase(pool, context.environment.schema)
      await valkey.connect()
      const accountId = randomUUID()
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, now(), now())`,
        [accountId, 'Realtime Producer', `${accountId}@example.test`],
      )
      const events: HomeRealtimeEvent[] = []
      const service = new RoomService({
        pool,
        valkey,
        valkeyPrefix: `${context.environment.valkeyPrefix}home-realtime:`,
        revokeConnections: () => undefined,
        publishHomeEvent: (event) => events.push(event),
      })

      const result = await service.createRoom(accountId, { name: 'Producer Room' })

      expect(result.status).toBe('created')
      if (result.status !== 'created') return
      expect(events.map((event) => event.type)).toEqual([
        'room-discovery',
        'room-membership',
      ])
      events.length = 0
      const confirmationRequired = await service.createRoom(accountId, {
        name: 'Producer Room 2',
      })
      expect(confirmationRequired.status).toBe('confirmation-required')
      if (confirmationRequired.status !== 'confirmation-required') return
      const moved = await service.createRoom(
        accountId,
        { name: 'Producer Room 2' },
        { confirmation: confirmationRequired.confirmation },
      )
      expect(moved.status).toBe('created')
      if (moved.status === 'created') {
        expect(events.map((event) => event.type)).toEqual([
          'room-membership',
          'room-discovery',
          'room-membership',
        ])
        expect(events[0]).toMatchObject({
          type: 'room-membership',
          roomId: result.room.id,
        })
      }

      const throwingAccountId = randomUUID()
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, now(), now())`,
        [throwingAccountId, 'Throwing Producer', `${throwingAccountId}@example.test`],
      )
      const throwingService = new RoomService({
        pool,
        valkey,
        valkeyPrefix: `${context.environment.valkeyPrefix}home-realtime-throwing:`,
        revokeConnections: () => undefined,
        publishHomeEvent: () => {
          throw new Error('notification failed')
        },
      })
      await expect(
        throwingService.createRoom(throwingAccountId, { name: 'No Retry Room' }),
      ).resolves.toMatchObject({ status: 'created' })
    } finally {
      await Promise.all([pool.end(), valkey.quit()])
    }
  })

afterAll(async () => {
  await accounts?.cleanup()
})

describe('Home realtime event contract', () => {
  test('bounds public patches and strips participant identities', () => {
    const event = normalizeHomeRealtimeEvent({
      type: 'room-value',
      roomId: 'room-opaque',
      memberCount: 4,
      streamCount: 2,
      state: 'full',
      preview: { previewKey: 'preview', updatedAt: '2026-01-01T00:00:00.000Z' },
      accountId: 'must-not-cross-wire',
      password: 'must-not-cross-wire',

    } as never)

    expect(event).toEqual({
      type: 'room-value',
      roomId: 'room-opaque',
      memberCount: 4,
      streamCount: 2,
      state: 'full',
      preview: { previewKey: 'preview', updatedAt: '2026-01-01T00:00:00.000Z' },
    })
  })

  test('canonical Home refresh propagates active-query failures', async () => {
    const failure = new Error('canonical refresh failed')
    const queryClient = {
      invalidateQueries: () => Promise.reject(failure),
    } as unknown as QueryClient

    await expect(refreshHomeQueries(queryClient)).rejects.toBe(failure)
  })

  test('patches values without reordering cached room cells', () => {
    const client = new QueryClient()
    const key = ['home', 'rooms', { q: '' }] as const
    client.setQueryData(key, [room('first'), room('second', 1)])

    applyHomeRealtimeEvent(client, {
      type: 'room-value',
      roomId: 'second',
      memberCount: 8,
      state: 'full',
    })

    expect(client.getQueryData<readonly ActiveRoomSummary[]>(key)?.map(({ id }) => id)).toEqual([
      'first',
      'second',
    ])
    expect(client.getQueryData<readonly ActiveRoomSummary[]>(key)?.[1]).toMatchObject({
      memberCount: 8,
      state: 'full',
    })
  })

  test('clears previews only when the preview field is explicitly null', () => {
    const client = new QueryClient()
    const key = ['home', 'rooms', { q: '' }] as const
    const withPreview = {
      ...room('preview-room'),
      previews: [{ previewKey: 'preview', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }
    client.setQueryData(key, [withPreview])

    applyHomeRealtimeEvent(client, { type: 'room-value', roomId: 'preview-room', preview: null })

    expect(client.getQueryData<readonly ActiveRoomSummary[]>(key)?.[0]?.previews).toEqual([])
  })

  test('targets membership invalidation to affected Home families', () => {
    const client = new QueryClient()
    const roomsKey = ['home', 'rooms', { q: '' }] as const
    const statsKey = ['home', 'statistics', { operatorDay: '2026-01-01' }] as const
    const profilesKey = ['home', 'profiles', { query: 'a' }] as const
    client.setQueryData(roomsKey, [room('first')])
    client.setQueryData(statsKey, { activeRoomCount: 1 })
    client.setQueryData(profilesKey, [])

    applyHomeRealtimeEvent(client, {
      type: 'room-membership',
      roomId: 'first',
      memberCount: 2,
      streamCount: 1,
    })

    expect(client.getQueryState(roomsKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(statsKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(profilesKey)?.isInvalidated).toBe(false)
  })

  test('closes an ended room cell without inserting a replacement', () => {
    const client = new QueryClient()
    const key = ['home', 'rooms', { q: '' }] as const
    client.setQueryData(key, [room('first'), room('second')])

    applyHomeRealtimeEvent(client, { type: 'room-ended', roomId: 'first' })

    expect(client.getQueryData<readonly ActiveRoomSummary[]>(key)?.map(({ id }) => id)).toEqual(['second'])
  })

  test('new authenticated Account connection displaces its older socket', async () => {
    const { context, accounts: harness } = await authHarness()
    const signedIn = await harness.signInDiscord({
      id: '102938475610293860',
      username: 'home-realtime',
    })
    const first = await openSocket(signedIn.sessionCookie, context.server.origin)
    const otherSignedIn = await harness.signInDiscord({
      id: '102938475610293861',
      username: 'home-realtime-other',
    })
    const other = await openSocket(otherSignedIn.sessionCookie, context.server.origin)
    const observedPresence: number[] = []
    const collectPresence = (value: unknown) => {
      const event = normalizeHomeRealtimeEvent(value)
      if (event?.type === 'presence') observedPresence.push(event.connectedAccountCount)
    }
    other.on(HOME_SOCKET_EVENT, collectPresence)
    const replaced = waitForSocketEvent(first, HOME_ACCOUNT_REPLACED_EVENT)
    const firstDisconnected = waitForSocketEvent(first, 'disconnect')
    const stablePresence = waitForHomeEvent(
      other,
      (event) => event.type === 'presence' && event.connectedAccountCount === 2,
    )
    const second = await openSocket(signedIn.sessionCookie, context.server.origin)
    await Promise.all([replaced, firstDisconnected, stablePresence])
    other.off(HOME_SOCKET_EVENT, collectPresence)
    expect(observedPresence).not.toContain(1)
    expect(first.disconnected).toBe(true)
    expect(second.connected).toBe(true)
    expect(other.connected).toBe(true)
  })

  test('event hub instances do not cross-talk and unsubscribe on disconnect', () => {
    const first = createHomeEventHub()
    const second = createHomeEventHub()
    const received: HomeRealtimeEvent[] = []
    const unsubscribe = first.subscribe((event) => received.push(event))
    const event: HomeRealtimeEvent = { type: 'room-ended', roomId: 'room-opaque' }

    second.publish(event)
    expect(received).toEqual([])
    first.publish(event)
    expect(received).toEqual([event])
    unsubscribe()
    first.publish(event)
    expect(received).toHaveLength(1)
    expect(HOME_SOCKET_EVENT).toBe('home:event')
  })
})
