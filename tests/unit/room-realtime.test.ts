import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import {
  applyRoomProjectionRealtimeEvent,
  invalidateRoomProjection,
  roomQueryKeys,
} from '../../src/features/room/room-queries'
import {
  bindRoomProjectionSocket,
  focusRoomPrimaryHeading,
} from '../../src/features/room/RoomRoute'
import { reconnectGraceSeconds } from '../../src/features/room/useRoomRealtime'

const ROOM_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ROOM_ID = '00000000-0000-4000-8000-000000000002'

function queryClient() {
  const invalidateQueries = vi.fn(() => Promise.resolve())
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    invalidateQueries,
  }
}

function roomSocket() {
  const handlers = new Map<string, (value?: unknown) => void>()
  const socket = {
    io: { opts: { reconnection: true } },
    on: vi.fn((event: string, handler: (value?: unknown) => void) => handlers.set(event, handler)),
    off: vi.fn((event: string) => handlers.delete(event)),
    disconnect: vi.fn(),
  }
  return { socket, handlers }
}

describe('Room realtime projection invalidation', () => {
  test.each([
    { type: 'room-ended', roomId: ROOM_ID },
    { type: 'room-discovery', roomId: ROOM_ID },
    { type: 'room-value', roomId: ROOM_ID, memberCount: 0 },
    { type: 'room-membership', roomId: ROOM_ID, memberCount: 0, streamCount: 0 },
  ])('invalidates the active canonical query for $type', async (event) => {
    const { client, invalidateQueries } = queryClient()

    await applyRoomProjectionRealtimeEvent(client, ROOM_ID, event)

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: roomQueryKeys.projection(ROOM_ID),
      exact: true,
      refetchType: 'active',
    })
  })

  test('canonicalizes uppercase route IDs before matching events and query keys', async () => {
    const { client, invalidateQueries } = queryClient()

    await applyRoomProjectionRealtimeEvent(client, ROOM_ID.toUpperCase(), {
      type: 'room-ended',
      roomId: ROOM_ID,
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: roomQueryKeys.projection(ROOM_ID),
      exact: true,
      refetchType: 'active',
    })
  })

  test('ignores malformed, unrelated-room, and presence events', () => {
    const { client, invalidateQueries } = queryClient()

    applyRoomProjectionRealtimeEvent(client, ROOM_ID, null)
    applyRoomProjectionRealtimeEvent(client, ROOM_ID, { type: 'room-ended', roomId: OTHER_ROOM_ID })
    applyRoomProjectionRealtimeEvent(client, ROOM_ID, { type: 'presence', connectedCount: 1 })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  test('account revocation invalidates the canonical query directly', async () => {
    const { client, invalidateQueries } = queryClient()

    await invalidateRoomProjection(client, ROOM_ID)

    expect(invalidateQueries).toHaveBeenCalledOnce()
  })

  test('refreshes on connect and clears transient state on terminal account events', () => {
    const { socket, handlers } = roomSocket()
    const onRefresh = vi.fn()
    const onRoomEvent = vi.fn()
    const onTerminal = vi.fn()
    const onReplacement = vi.fn()
    const cleanup = bindRoomProjectionSocket(socket, {
      onRefresh,
      onRoomEvent,
      onTerminal,
      onReplacement,
    })

    handlers.get('connect')?.()
    handlers.get('home:account-revoked')?.()
    handlers.get('home:account-replaced')?.()

    expect(onRefresh).toHaveBeenCalledTimes(2)
    expect(onTerminal).toHaveBeenCalledTimes(2)
    expect(onReplacement).toHaveBeenCalledOnce()
    expect(socket.io.opts.reconnection).toBe(false)
    expect(socket.disconnect).toHaveBeenCalledTimes(2)

    cleanup()
    expect(socket.off).toHaveBeenCalledTimes(4)
  })

  test('focuses the primary heading after an in-place projection transition', () => {
    const focus = vi.fn()
    const root = {
      querySelector: vi.fn(() => ({ focus })),
    } as unknown as Pick<Document, 'querySelector'>

    focusRoomPrimaryHeading(root)

    expect(root.querySelector).toHaveBeenCalledWith('[data-room-primary-heading]')
    expect(focus).toHaveBeenCalledOnce()
  })

  test('shows the fixed reconnect deadline from 45 through expiry', () => {
    const deadline = 50_000
    expect(reconnectGraceSeconds(deadline, 5_000)).toBe(45)
    expect(reconnectGraceSeconds(deadline, 5_001)).toBe(45)
    expect(reconnectGraceSeconds(deadline, 49_999)).toBe(1)
    expect(reconnectGraceSeconds(deadline, 50_000)).toBe(0)
    expect(reconnectGraceSeconds(deadline, 75_000)).toBe(0)
  })
})
