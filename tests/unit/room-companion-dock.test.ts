import { describe, expect, test } from 'vitest'
import { formatActivityTime } from '../../src/features/room/RoomCompanionDock'

describe('formatActivityTime', () => {
  test('formats valid activity times exactly and rejects malformed realtime values', () => {
    expect(formatActivityTime('2026-08-09T12:34:00')).toMatch(/^12:34\sPM$/u)
    expect(formatActivityTime('not-a-timestamp')).toBeNull()
  })
})
