import { describe, expect, test } from 'vitest'
import {
  selectRoomRouteProjection,
  projectDisplacedRoom,
  type RoomProjectionSnapshot,
} from '../../src/server/rooms/room-projection'

const snapshot = (
  overrides: Partial<RoomProjectionSnapshot> = {},
): RoomProjectionSnapshot => ({
  room: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Projection room',
    category: 'Games',
    description: 'A blurb for the room.',
    tags: ['friends'],
    visibility: 'public',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: null,
  },
  memberCount: 2,
  streamCount: 1,
  self: null,
  viewerAuthenticated: false,
  roster: [],
  watchingStreamId: null,
  ...overrides,
})

describe('Room route projection selector', () => {
  test('keeps missing outside the closed projection union', () => {
    expect(selectRoomRouteProjection({ ...snapshot(), room: null })).toBeNull()
  })

  test.each([
    ['public', 2, 'open'],
    ['private', 2, 'password-required'],
    ['public', 10, 'full'],
  ] as const)('selects %s pre-admission without private fields', (visibility, memberCount, admission) => {
    const projection = selectRoomRouteProjection(
      snapshot({
        memberCount,
        room: { ...snapshot().room!, visibility },
        viewerAuthenticated: true,
      }),
    )

    expect(projection).toMatchObject({
      kind: 'preAdmission',
      room: { admission, memberCount, visibility, viewerAuthenticated: true },
    })
    expect(JSON.stringify(projection)).not.toMatch(/"(?:password|passwordHash|password_hash|members|accountId)":/i)
  })

  test('selects the admitted projection only for membership in this room', () => {
    const projection = selectRoomRouteProjection(
      snapshot({ self: { id: '00000000-0000-4000-8000-000000000002', role: 'host' } }),
    )

    expect(projection).toMatchObject({
      kind: 'admitted',
      self: { role: 'host' },
      room: { memberCount: 2, streamCount: 1 },
    })
  })

  test.each([
    'kick',
    'ban',
    'connection displacement',
    'all-access sanction',
    'admission loss',
  ])('%s removes self and returns the same room to pre-admission', () => {
    expect(selectRoomRouteProjection(snapshot({
      self: null,
      viewerAuthenticated: true,
    }))).toMatchObject({
      kind: 'preAdmission',
      room: {
        id: snapshot().room!.id,
        admission: 'open',
        viewerAuthenticated: true,
      },
    })
  })

  test('connection replacement projects the displaced client back to pre-admission', () => {
    const admitted = selectRoomRouteProjection(snapshot({
      self: { id: '00000000-0000-4000-8000-000000000002', role: 'host' },
      viewerAuthenticated: true,
    }))
    if (admitted?.kind !== 'admitted') throw new Error('Expected admitted fixture')

    expect(projectDisplacedRoom(admitted)).toMatchObject({
      kind: 'preAdmission',
      room: {
        id: admitted.room.id,
        admission: 'open',
        viewerAuthenticated: true,
      },
    })
  })

  test.each(['normal end', 'admin end'])('%s selects Past Stream from canonical ended state', () => {
    const endedAt = new Date('2026-01-01T02:00:00.000Z')
    expect(
      selectRoomRouteProjection(snapshot({ room: { ...snapshot().room!, endedAt } })),
    ).toMatchObject({
      kind: 'pastStream',
      room: { endedAt },
    })
  })
})
