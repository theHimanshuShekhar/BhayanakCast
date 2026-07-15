import { describe, expect, test } from 'vitest'
import { rankProfiles, rankRooms } from '../../src/features/home/home-search'

const rooms = [
  { id: 'z', name: 'Movie Club', category: 'Film', tags: ['classic'], memberCount: 2, streamCount: 1, activityAt: '2026-07-14T10:00:00.000Z' },
  { id: 'a', name: 'Movie Night', category: 'Film', tags: ['new'], memberCount: 8, streamCount: 3, activityAt: '2026-07-14T09:00:00.000Z' },
  { id: 'b', name: 'The Movies', category: 'Talk', tags: ['cinema'], memberCount: 9, streamCount: 1, activityAt: '2026-07-14T11:00:00.000Z' },
  { id: 'c', name: 'Moive archive', category: null, tags: [], memberCount: 10, streamCount: 2, activityAt: '2026-07-14T11:00:00.000Z' },
]

describe('Home discovery ranking', () => {
  test('requires every selected tag and an exact category after normalization', () => {
    expect(
      rankRooms(rooms, { category: 'Film', tags: ['classic', 'new'] }).map((room) => room.id),
    ).toEqual([])
    expect(rankRooms(rooms, { category: 'Film', tags: ['classic'] }).map((room) => room.id)).toEqual(['z'])
  })

  test('orders direct exact, prefix, and substring matches before fuzzy results', () => {
    expect(rankRooms(rooms, { q: 'movie' }).map((room) => room.id)).toEqual(['a', 'z', 'b', 'c'])
  })

  test('does not add fuzzy results below three visible characters', () => {
    expect(
      rankRooms(
        [{ id: 'typo', name: 'mo', category: null, tags: [], memberCount: 1, streamCount: 0, activityAt: '2026-07-14T00:00:00.000Z' }],
        { q: 'me' },
      ),
    ).toEqual([])
  })

  test('uses social rank then stable opaque room IDs to break room ties', () => {
    const tied = rooms.slice(0, 2).map((room) => ({ ...room, memberCount: 2, streamCount: 1, activityAt: '2026-07-14T10:00:00.000Z' }))
    expect(rankRooms(tied, {}).map((room) => room.id)).toEqual(['a', 'z'])
  })

  test('orders profile ties by normalized display name then opaque ID', () => {
    expect(
      rankProfiles([
        { accountId: 'z', displayName: 'Zoë' },
        { accountId: 'b', displayName: 'Amy' },
        { accountId: 'a', displayName: 'Amy' },
      ], {}).map((profile) => profile.accountId),
    ).toEqual(['a', 'b', 'z'])
  })
})
