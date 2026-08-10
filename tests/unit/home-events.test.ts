import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import { applyHomeRealtimeEvent } from '../../src/server/realtime/home-events'
import type { ActiveRoomSummary, HomeStatistics } from '../../src/features/home/home-types'

const room: ActiveRoomSummary = {
  id: 'room-1',
  name: 'Room one',
  category: null,
  description: null,
  tags: [],
  visibility: 'public',
  memberCount: 2,
  capacity: 10,
  streamCount: 1,
  state: 'live',
  hostName: 'Host',
  previews: [],
  memberAvatars: [],
}

const statistics: HomeStatistics = {
  activeRoomCount: 1,
  activeStreamCount: 1,
  currentMembershipCount: 2,
  roomsCreatedToday: 3,
  peakConnectedCount: 4,
}

describe('Home realtime cache patches', () => {
  test('patches membership and statistics without invalidating the room query', () => {
    const client = new QueryClient()
    const roomsKey = ['home', 'rooms', { search: '' }] as const
    const statisticsKey = ['home', 'statistics', { operatorDay: '2026-08-10' }] as const
    client.setQueryData(roomsKey, [room])
    client.setQueryData(statisticsKey, statistics)

    applyHomeRealtimeEvent(client, {
      type: 'room-membership',
      roomId: room.id,
      memberCount: 4,
      streamCount: 2,
    })

    expect(client.getQueryData<typeof room[]>(roomsKey)?.[0]).toMatchObject({
      memberCount: 4,
      streamCount: 2,
    })
    expect(client.getQueryData<HomeStatistics>(statisticsKey)).toMatchObject({
      currentMembershipCount: 4,
      activeStreamCount: 2,
    })
    expect(client.getQueryState(roomsKey)?.isInvalidated).toBe(false)
  })

  test('patches statistics for a room absent from a filtered result set', () => {
    const client = new QueryClient()
    const roomsKey = ['home', 'rooms', { search: 'filtered' }] as const
    const statisticsKey = ['home', 'statistics', { operatorDay: '2026-08-10' }] as const
    client.setQueryData(roomsKey, [room])
    client.setQueryData(statisticsKey, statistics)

    applyHomeRealtimeEvent(client, {
      type: 'room-membership',
      roomId: 'room-not-in-view',
      memberCount: 5,
      streamCount: 3,
      memberCountDelta: 1,
      streamCountDelta: 2,
    })

    expect(client.getQueryData<HomeStatistics>(statisticsKey)).toMatchObject({
      currentMembershipCount: 3,
      activeStreamCount: 3,
    })
    expect(client.getQueryState(roomsKey)?.isInvalidated).toBe(false)
  })

  test('invalidates statistics when a filtered event has no delta baseline', () => {
    const client = new QueryClient()
    const roomsKey = ['home', 'rooms', { search: 'filtered' }] as const
    const statisticsKey = ['home', 'statistics', { operatorDay: '2026-08-10' }] as const
    client.setQueryData(roomsKey, [room])
    client.setQueryData(statisticsKey, statistics)

    applyHomeRealtimeEvent(client, {
      type: 'room-membership',
      roomId: 'room-not-in-view',
      memberCount: 5,
      streamCount: 3,
    })

    expect(client.getQueryState(statisticsKey)?.isInvalidated).toBe(true)
  })

  test('preserves the cached room array when an event targets an absent room', () => {
    const client = new QueryClient()
    const roomsKey = ['home', 'rooms', { search: '' }] as const
    const rooms = [room]
    client.setQueryData(roomsKey, rooms)

    applyHomeRealtimeEvent(client, {
      type: 'room-membership',
      roomId: 'room-not-in-view',
      memberCount: 5,
      streamCount: 3,
    })

    expect(client.getQueryData<typeof rooms>(roomsKey)).toBe(rooms)
  })
})
