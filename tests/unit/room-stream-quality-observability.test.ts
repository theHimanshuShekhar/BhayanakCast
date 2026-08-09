import { describe, expect, it } from 'vitest'
import { validateRoomAnalyticsEnvelope } from '../../src/server/observability/room-analytics'

const anonymousId = 'd0b172a2-e031-4b77-b15a-a327f4f0b97e'
const event = {
  name: 'room_stream_quality',
  properties: {
    encoder_implementation: 'ExternalEncoderFactory',
    quality_limitation_reason: 'bandwidth',
    frames_per_second: 58.7,
    frame_height: 1080,
  },
}

describe('Stream quality analytics allowlist', () => {
  it('accepts the exact encoder quality sample', () => {
    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({
      anonymousId,
      event,
    })
  })

  it.each([
    {
      ...event,
      properties: { ...event.properties, room_name: 'forbidden content' },
    },
    {
      ...event,
      properties: {
        encoder_implementation: event.properties.encoder_implementation,
        frames_per_second: event.properties.frames_per_second,
        frame_height: event.properties.frame_height,
      },
    },
    {
      ...event,
      properties: { ...event.properties, quality_limitation_reason: 'other' },
    },
  ])('rejects content, missing properties, and unknown limitation reasons', (invalidEvent) => {
    expect(() =>
      validateRoomAnalyticsEnvelope({ anonymousId, event: invalidEvent }),
    ).toThrow()
  })
})
