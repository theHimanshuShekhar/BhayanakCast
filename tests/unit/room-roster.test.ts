import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
  orderRoomPeople,
  orderRoomRoster,
  preserveRoomRosterOrder,
  type RoomRosterMember,
} from '../../src/server/rooms/room-roster'

const member = (
  overrides: Partial<RoomRosterMember> & Pick<RoomRosterMember, 'membershipId'>,
): RoomRosterMember => ({
  accountId: `account-${overrides.membershipId}`,
  displayName: `Member ${overrides.membershipId}`,
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  reconnecting: false,
  streamId: null,
  previewKey: null,
  previewUpdatedAt: null,
  watcherCount: 0,
  watchers: [],
  ...overrides,
})

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes))

const names = (members: readonly RoomRosterMember[]) =>
  members.map((entry) => entry.membershipId)

describe('Mosaic roster order (ADR 0101)', () => {
  test('leads with the viewer, then the Host, then join time', () => {
    const roster = [
      member({ membershipId: 'c', joinedAt: at(3) }),
      member({ membershipId: 'host', joinedAt: at(0), role: 'host' }),
      member({ membershipId: 'b', joinedAt: at(2) }),
      member({ membershipId: 'me', joinedAt: at(4) }),
    ]

    expect(names(orderRoomRoster(roster, 'me'))).toEqual(['me', 'host', 'b', 'c'])
  })

  test('does not promote the Host twice when the viewer is the Host', () => {
    const roster = [
      member({ membershipId: 'b', joinedAt: at(2) }),
      member({ membershipId: 'me', joinedAt: at(5), role: 'host' }),
      member({ membershipId: 'a', joinedAt: at(1) }),
    ]

    expect(names(orderRoomRoster(roster, 'me'))).toEqual(['me', 'a', 'b'])
  })

  test('breaks equal join times by name, then identity, so the order is total', () => {
    const together = at(7)
    const roster = [
      member({ membershipId: 'z', displayName: 'Ada', joinedAt: together }),
      member({ membershipId: 'a', displayName: 'Ada', joinedAt: together }),
      member({ membershipId: 'm', displayName: 'Abe', joinedAt: together }),
    ]

    expect(names(orderRoomRoster(roster, 'nobody'))).toEqual(['m', 'a', 'z'])
  })

  test('leaves a viewer who is not in the roster out of the ordering', () => {
    const roster = [
      member({ membershipId: 'b', joinedAt: at(2) }),
      member({ membershipId: 'host', joinedAt: at(9), role: 'host' }),
    ]

    expect(names(orderRoomRoster(roster, 'absent'))).toEqual(['host', 'b'])
  })

  test('sorts a copy rather than the caller`s roster', () => {
    const roster = [
      member({ membershipId: 'b', joinedAt: at(2) }),
      member({ membershipId: 'me', joinedAt: at(4) }),
    ]

    orderRoomRoster(roster, 'me')

    expect(names(roster)).toEqual(['b', 'me'])
  })
  test('keeps existing positions through Host and Stream changes, then appends joins', () => {
    const initial = orderRoomRoster(
      [
        member({ membershipId: 'host', joinedAt: at(0), role: 'host' }),
        member({ membershipId: 'me', joinedAt: at(1) }),
        member({ membershipId: 'later', joinedAt: at(2) }),
      ],
      'me',
    )
    const refreshed = [
      member({ membershipId: 'host', joinedAt: at(0), streamId: 'stream-host' }),
      member({ membershipId: 'me', joinedAt: at(1), role: 'host' }),
      member({ membershipId: 'later', joinedAt: at(2), reconnecting: true }),
      member({ membershipId: 'new', joinedAt: at(3) }),
    ]

    const stable = preserveRoomRosterOrder(initial, refreshed, 'me')

    expect(names(stable)).toEqual(['me', 'host', 'later', 'new'])
    expect(stable[1]).toMatchObject({ role: 'member', streamId: 'stream-host' })
    expect(stable[2]).toMatchObject({ reconnecting: true })
  })

  test('preserves every surviving position for arbitrary state changes and removals', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 30 }), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.array(fc.boolean(), { minLength: 31, maxLength: 31 }),
        (ids, retained) => {
          const initial = ids.map((id, index) =>
            member({ membershipId: String(id), joinedAt: at(index) }),
          )
          const survivorSet = new Set(ids.filter((id) => retained[id]))
          const next = initial
            .filter((entry) => survivorSet.has(Number(entry.membershipId)))
            .reverse()
            .map((entry, index) => ({
              ...entry,
              role: index === 0 ? ('host' as const) : ('member' as const),
              reconnecting: index % 2 === 0,
              streamId: index % 2 === 0 ? `stream-${entry.membershipId}` : null,
            }))

          expect(names(preserveRoomRosterOrder(initial, next, initial[0]!.membershipId))).toEqual(
            ids.filter((id) => survivorSet.has(id)).map(String),
          )
        },
      ),
    )
  })
})

describe('People order (ADR 0102)', () => {
  test('leads with the Host, then the viewer, then streamers, then join time', () => {
    const roster = [
      member({ membershipId: 'quiet', joinedAt: at(1) }),
      member({ membershipId: 'me', joinedAt: at(4) }),
      member({ membershipId: 'sharing', joinedAt: at(6), streamId: 'stream-1' }),
      member({ membershipId: 'host', joinedAt: at(8), role: 'host' }),
    ]

    expect(names(orderRoomPeople(roster, 'me'))).toEqual([
      'host',
      'me',
      'sharing',
      'quiet',
    ])
  })

  test('differs from the mosaic order for the same room', () => {
    const roster = [
      member({ membershipId: 'host', joinedAt: at(0), role: 'host' }),
      member({ membershipId: 'me', joinedAt: at(4) }),
    ]

    expect(names(orderRoomRoster(roster, 'me'))).toEqual(['me', 'host'])
    expect(names(orderRoomPeople(roster, 'me'))).toEqual(['host', 'me'])
  })
})
