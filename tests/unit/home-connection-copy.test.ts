import { describe, expect, test } from 'vitest'
import { lastSeenLabel } from '../../src/features/home/HomeConnectionStatus'

describe('Home connection freshness copy', () => {
  test('rounds coarsely so a slow tick never contradicts itself', () => {
    expect(lastSeenLabel(0)).toBe('5 seconds ago')
    expect(lastSeenLabel(6_000)).toBe('5 seconds ago')
    expect(lastSeenLabel(8_500)).toBe('10 seconds ago')
    expect(lastSeenLabel(59_000)).toBe('1 minute ago')
    expect(lastSeenLabel(120_000)).toBe('2 minutes ago')
    expect(lastSeenLabel(3_600_000)).toBe('1 hour ago')
    expect(lastSeenLabel(-5_000)).toBe('5 seconds ago')
  })
})
