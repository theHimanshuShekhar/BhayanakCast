import { describe, expect, it } from 'vitest'
import { roomStreamQualityEvent } from '../../src/features/room/useRoomMedia'

const completeSample = {
  id: 'outbound-video',
  type: 'outbound-rtp',
  kind: 'video',
  encoderImplementation: 'ExternalEncoderFactory',
  qualityLimitationReason: 'cpu',
  framesPerSecond: 57.5,
  frameHeight: 900,
}

describe('Stream quality sample', () => {
  it('maps outbound video encoder statistics to analytics', () => {
    const report = new Map<string, unknown>([
      ['inbound-video', { type: 'inbound-rtp', kind: 'video' }],
      [completeSample.id, completeSample],
    ])

    expect(roomStreamQualityEvent(report)).toEqual({
      name: 'room_stream_quality',
      properties: {
        encoder_implementation: 'ExternalEncoderFactory',
        quality_limitation_reason: 'cpu',
        frames_per_second: 57.5,
        frame_height: 900,
      },
    })
  })

  it.each([
    new Map(),
    new Map([['audio', { ...completeSample, kind: 'audio' }]]),
    new Map([['video', { ...completeSample, encoderImplementation: undefined }]]),
    new Map([['video', { ...completeSample, qualityLimitationReason: 'other' }]]),
    new Map([['video', { ...completeSample, framesPerSecond: undefined }]]),
    new Map([['video', { ...completeSample, frameHeight: undefined }]]),
  ])('returns nothing when outbound video statistics are missing or incomplete', (report) => {
    expect(roomStreamQualityEvent(report)).toBeUndefined()
  })
})
