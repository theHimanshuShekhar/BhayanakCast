import { describe, expect, test } from 'vitest'
import {
  createRoomPresentation,
  reconcileRoomPresentation,
  transitionRoomPresentation,
} from '../../src/features/home/LiveRooms'
import type { ActiveRoomSummary } from '../../src/features/home/home-types'

function room(id: string, memberCount: number): ActiveRoomSummary {
  return {
    id,
    name: `Room ${id}`,
    category: null,
    tags: [],
    visibility: 'public',
    memberCount,
    streamCount: 0,
    state: 'live',
    previews: [],
    memberAvatars: [],
  }
}

describe('Live Rooms presentation snapshot', () => {
  test('preserves the canonical incoming rank order', () => {
    const presentation = createRoomPresentation([
      room('rank-1', 9),
      room('rank-2', 7),
      room('rank-3', 5),
    ])

    expect(presentation.rooms.map(({ id }) => id)).toEqual([
      'rank-1',
      'rank-2',
      'rank-3',
    ])
    expect(presentation.featuredId).toBe('rank-1')
  })

  test('updates values without changing order or featured identity', () => {
    const initial = createRoomPresentation([
      room('rank-1', 9),
      room('rank-2', 7),
      room('rank-3', 5),
    ])
    const presentation = reconcileRoomPresentation(initial, [
      room('rank-3', 12),
      room('rank-2', 10),
      room('rank-1', 1),
    ])

    expect(presentation.rooms.map(({ id }) => id)).toEqual([
      'rank-1',
      'rank-2',
      'rank-3',
    ])
    expect(presentation.rooms.map(({ memberCount }) => memberCount)).toEqual([
      1,
      10,
      12,
    ])
    expect(presentation.featuredId).toBe('rank-1')
  })

  test('removes an ended featured room without promoting another room', () => {
    const initial = createRoomPresentation([
      room('rank-1', 9),
      room('rank-2', 7),
      room('rank-3', 5),
    ])
    const presentation = reconcileRoomPresentation(initial, [
      room('rank-3', 12),
      room('rank-2', 10),
    ])

    expect(presentation.rooms.map(({ id }) => id)).toEqual([
      'rank-2',
      'rank-3',
    ])
    expect(presentation.featuredId).toBe('rank-1')
    expect(
      presentation.rooms.some(({ id }) => id === presentation.featuredId),
    ).toBe(false)
  })

  test('appends newly ranked rooms without promoting them into the snapshot', () => {
    const initial = createRoomPresentation([
      room('rank-1', 9),
      room('rank-2', 7),
      room('rank-3', 5),
    ])
    const presentation = reconcileRoomPresentation(initial, [
      room('new-rank-1', 12),
      room('rank-1', 9),
      room('rank-2', 7),
      room('rank-3', 5),
    ])

    expect(presentation.rooms.map(({ id }) => id)).toEqual([
      'rank-1',
      'rank-2',
      'rank-3',
      'new-rank-1',
    ])
    expect(presentation.featuredId).toBe('rank-1')
  })

  test('waits for canonical results before resetting a changed snapshot', () => {
    const previous = createRoomPresentation([
      room('old-rank-1', 9),
      room('shared-room', 7),
    ])
    const placeholder = transitionRoomPresentation(
      previous,
      previous.rooms,
      true,
      true,
    )
    const canonical = transitionRoomPresentation(
      placeholder,
      [room('new-rank-1', 12), room('shared-room', 7)],
      true,
      false,
    )

    expect(placeholder).toBe(previous)
    expect(canonical.rooms.map(({ id }) => id)).toEqual([
      'new-rank-1',
      'shared-room',
    ])
    expect(canonical.featuredId).toBe('new-rank-1')
  })
})
