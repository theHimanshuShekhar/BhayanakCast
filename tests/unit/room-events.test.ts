import { describe, expect, test } from 'vitest'
import {
  createRoomEventHub,
  normalizeRoomRealtimeEvent,
  normalizeSignalPayload,
} from '../../src/server/realtime/room-events'

const ROOM_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ROOM_ID = '00000000-0000-4000-8000-000000000002'

describe('normalizeSignalPayload', () => {
  test('accepts the three negotiation frames and a close', () => {
    expect(normalizeSignalPayload({ kind: 'offer', sdp: 'v=0' })).toEqual({
      kind: 'offer',
      sdp: 'v=0',
    })
    expect(normalizeSignalPayload({ kind: 'answer', sdp: 'v=0' })).toEqual({
      kind: 'answer',
      sdp: 'v=0',
    })
    expect(
      normalizeSignalPayload({
        kind: 'candidate',
        candidate: 'candidate:1 1 udp',
        sdpMid: '0',
        sdpMLineIndex: 0,
      }),
    ).toEqual({
      kind: 'candidate',
      candidate: 'candidate:1 1 udp',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
    expect(normalizeSignalPayload({ kind: 'close' })).toEqual({ kind: 'close' })
  })

  test('rejects malformed frames rather than relaying them', () => {
    expect(normalizeSignalPayload({ kind: 'offer' })).toBeNull()
    expect(normalizeSignalPayload({ kind: 'offer', sdp: 'x'.repeat(64_001) })).toBeNull()
    expect(
      normalizeSignalPayload({
        kind: 'candidate',
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: -1,
      }),
    ).toBeNull()
    expect(normalizeSignalPayload({ kind: 'renegotiate' })).toBeNull()
    expect(normalizeSignalPayload(null)).toBeNull()
  })
})

describe('normalizeRoomRealtimeEvent', () => {
  test('keeps the minute mark on a warning and nothing else', () => {
    expect(
      normalizeRoomRealtimeEvent({
        type: 'activity',
        roomId: ROOM_ID,
        entry: {
          id: 'a1',
          kind: 'room-warning',
          at: '2026-01-01T00:00:00.000Z',
          minutes: 1,
          reason: 'capacity abuse',
        },
      }),
    ).toEqual({
      type: 'activity',
      roomId: ROOM_ID,
      entry: {
        id: 'a1',
        kind: 'room-warning',
        displayName: null,
        at: '2026-01-01T00:00:00.000Z',
        minutes: 1,
      },
    })
  })

  test('rejects a warning without one of the three marks', () => {
    expect(
      normalizeRoomRealtimeEvent({
        type: 'activity',
        roomId: ROOM_ID,
        entry: { id: 'a1', kind: 'room-warning', at: '2026-01-01T00:00:00.000Z', minutes: 5 },
      }),
    ).toBeNull()
  })

  test('rejects unknown types and events without a room', () => {
    expect(normalizeRoomRealtimeEvent({ type: 'kick', roomId: ROOM_ID })).toBeNull()
    expect(normalizeRoomRealtimeEvent({ type: 'room-ended' })).toBeNull()
  })
})

describe('createRoomEventHub', () => {
  test('delivers only to the room the event names', () => {
    const hub = createRoomEventHub()
    const mine: unknown[] = []
    const theirs: unknown[] = []
    hub.subscribe(ROOM_ID, (event) => mine.push(event))
    hub.subscribe(OTHER_ROOM_ID, (event) => theirs.push(event))

    hub.publish({ type: 'membership-changed', roomId: ROOM_ID })

    expect(mine).toEqual([{ type: 'membership-changed', roomId: ROOM_ID }])
    expect(theirs).toEqual([])
  })

  test('a throwing subscriber does not stop the others', () => {
    const hub = createRoomEventHub()
    const received: unknown[] = []
    hub.subscribe(ROOM_ID, () => {
      throw new Error('subscriber exploded')
    })
    hub.subscribe(ROOM_ID, (event) => received.push(event))

    hub.publish({ type: 'room-ended', roomId: ROOM_ID })

    expect(received).toHaveLength(1)
  })

  test('unsubscribing stops delivery', () => {
    const hub = createRoomEventHub()
    const received: unknown[] = []
    const unsubscribe = hub.subscribe(ROOM_ID, (event) => received.push(event))
    unsubscribe()

    hub.publish({ type: 'room-ended', roomId: ROOM_ID })

    expect(received).toEqual([])
  })
})
