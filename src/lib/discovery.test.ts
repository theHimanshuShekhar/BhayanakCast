import { describe, expect, test } from 'vitest'
import type { DiscoveryRoom } from './discovery'
import { filterDiscoveryRooms, splitDiscoveryRooms } from './discovery'

const rooms: DiscoveryRoom[] = [
  {
    id: '1',
    name: 'Rust pair jam',
    host: 'ferris',
    category: 'coding',
    tags: ['rust', 'pair'],
    members: 3,
    streams: 1,
    private: false,
    state: 'live',
    endedAt: null,
  },
  {
    id: '2',
    name: 'Movie night',
    host: 'theater',
    category: 'films',
    tags: ['cinema'],
    members: 6,
    streams: 0,
    private: true,
    state: 'ended',
    endedAt: '2026-06-21T00:00:00.000Z',
  },
]

describe('filterDiscoveryRooms', () => {
  test('matches room name, host, and category case-insensitively', () => {
    expect(filterDiscoveryRooms(rooms, 'RUST')).toEqual([rooms[0]])
    expect(filterDiscoveryRooms(rooms, 'theater')).toEqual([rooms[1]])
    expect(filterDiscoveryRooms(rooms, 'films')).toEqual([rooms[1]])
    expect(filterDiscoveryRooms(rooms, 'cinema')).toEqual([rooms[1]])
    expect(filterDiscoveryRooms(rooms, '  ')).toEqual(rooms)
  })

  test('splits live rooms from past streams', () => {
    expect(splitDiscoveryRooms(rooms)).toEqual({
      liveRooms: [rooms[0]],
      pastRooms: [rooms[1]],
    })
  })
})
