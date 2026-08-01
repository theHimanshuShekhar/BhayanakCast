import { describe, expect, it } from 'vitest'
import { validateRoomAnalyticsEnvelope } from '../../src/server/observability/room-analytics'

const anonymousId = 'd0b172a2-e031-4b77-b15a-a327f4f0b97e'

describe('Room kick analytics allowlist', () => {
  it.each([
    {
      name: 'room_member_action_selected',
      properties: { surface: 'people', action: 'kick' },
    },
    {
      name: 'room_kick_confirmation_cancelled',
      properties: {},
    },
    {
      name: 'room_kick_confirmation_confirmed',
      properties: {},
    },
  ])('accepts the exact content-free $name interaction', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_member_action_selected',
      properties: { surface: 'tile', action: 'kick', targetAccountId: 'private' },
    },
    {
      name: 'room_kick_confirmation_cancelled',
      properties: { displayName: 'private' },
    },
    {
      name: 'room_kick_confirmation_confirmed',
      properties: { roomId: 'private' },
    },
  ])('rejects content and identifiers for $name', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})
