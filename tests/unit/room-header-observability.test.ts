import { describe, expect, it } from 'vitest'
import { validateRoomAnalyticsEnvelope } from '../../src/server/observability/room-analytics'

const anonymousId = 'd0b172a2-e031-4b77-b15a-a327f4f0b97e'

describe('Room header and Details analytics allowlist', () => {
  it.each([
    {
      name: 'room_header_action',
      properties: { action: 'details', surface: 'mobile' },
    },
    {
      name: 'room_header_action',
      properties: { action: 'settings', surface: 'details' },
    },
    {
      name: 'room_details_closed',
      properties: { reason: 'escape' },
    },
    {
      name: 'room_details_resized',
      properties: { height: '90' },
    },
  ])('accepts the exact $name payload', (event) => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      name: 'room_header_action',
      properties: { action: 'details', surface: 'mobile', roomName: 'private' },
    },
    {
      name: 'room_header_action',
      properties: { action: 'open', surface: 'mobile' },
    },
    {
      name: 'room_details_closed',
      properties: { reason: 'outside', roomId: 'private' },
    },
    {
      name: 'room_details_resized',
      properties: { height: '75' },
    },
  ])('rejects content, unknown properties, and values', (event) => {
    expect(() => validateRoomAnalyticsEnvelope({ anonymousId, event })).toThrow()
  })
})
