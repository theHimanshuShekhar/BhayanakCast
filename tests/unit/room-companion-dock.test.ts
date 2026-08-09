import { describe, expect, test } from 'vitest'
import { formatActivityTime } from '../../src/features/room/RoomCompanionDock'

describe('formatActivityTime', () => {
  test('formats valid activity times and rejects malformed realtime values', () => {
    expect(formatActivityTime('2026-08-09T12:34:00.000Z')).not.toBeNull()
    expect(formatActivityTime('not-a-timestamp')).toBeNull()
  })
})
