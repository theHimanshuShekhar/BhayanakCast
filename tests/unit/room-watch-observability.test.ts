import { describe, expect, it } from 'vitest'
import {
  beginWatchSequence,
  retryWatchSequence,
  roomWatchEvent,
} from '../../src/features/room/useRoomMedia'
import { validateRoomAnalyticsEnvelope } from '../../src/server/observability/room-analytics'

const anonymousId = 'd0b172a2-e031-4b77-b15a-a327f4f0b97e'
const watchSequenceId = 'c6db6c55-dfa5-4edc-8758-3ca062646c7c'

describe('watch attempt analytics', () => {
  it('retains the successful attempt and watch sequence', () => {
    expect(roomWatchEvent('watch', 'connected', 3, watchSequenceId)).toEqual({
      name: 'room_watch_action',
      properties: {
        action: 'watch',
        outcome: 'connected',
        attempt: 3,
        watch_sequence_id: watchSequenceId,
      },
    })
  })

  it('advances one correlated sequence through all four attempts', () => {
    const attempts = [beginWatchSequence(watchSequenceId)]
    for (let index = 1; index < 4; index += 1) {
      attempts.push(retryWatchSequence(attempts[index - 1]))
    }

    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3, 4])
    expect(new Set(attempts.map((attempt) => attempt.id))).toEqual(
      new Set([watchSequenceId]),
    )
    expect(
      roomWatchEvent(
        'cancel',
        'cancelled',
        attempts[3].attempt,
        attempts[3].id,
      ),
    ).toMatchObject({
      properties: { attempt: 4, watch_sequence_id: watchSequenceId },
    })
  })

  it('mints a distinct UUID for every new selection', () => {
    const first = beginWatchSequence()
    const second = beginWatchSequence()

    expect(first.attempt).toBe(1)
    expect(second.attempt).toBe(1)
    expect(first.id).not.toBe(second.id)
    expect(() =>
      validateRoomAnalyticsEnvelope({
        anonymousId,
        event: roomWatchEvent('watch', 'started', first.attempt, first.id),
      }),
    ).not.toThrow()
  })

  it('accepts only a UUID watch sequence', () => {
    const event = roomWatchEvent('retry', 'started', 1, watchSequenceId)

    expect(validateRoomAnalyticsEnvelope({ anonymousId, event })).toEqual({ anonymousId, event })
    expect(() =>
      validateRoomAnalyticsEnvelope({
        anonymousId,
        event: {
          ...event,
          properties: { ...event.properties, watch_sequence_id: 'not-a-uuid' },
        },
      }),
    ).toThrow()
  })
})
