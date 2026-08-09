import { describe, expect, it } from 'vitest'
import {
  roomCountdownLabel,
  roomCountdownState,
} from '../../src/features/room/room-countdown'

const NOW = Date.UTC(2026, 6, 31, 12)
const expiresIn = (minutes: number, extraMilliseconds = 0) =>
  new Date(NOW + minutes * 60_000 + extraMilliseconds)

describe('Room lifetime countdown', () => {
  it.each([
    { remainingMinutes: 31, expected: 'normal' },
    { remainingMinutes: 30, expected: 'thirty-minute' },
    { remainingMinutes: 11, expected: 'thirty-minute' },
    { remainingMinutes: 10, expected: 'ten-minute' },
    { remainingMinutes: 2, expected: 'ten-minute' },
    { remainingMinutes: 1, expected: 'one-minute' },
    { remainingMinutes: 0, expected: 'one-minute' },
  ] as const)(
    'maps $remainingMinutes minutes remaining to $expected',
    ({ remainingMinutes, expected }) => {
      expect(roomCountdownState(expiresIn(remainingMinutes), NOW)).toBe(expected)
    },
  )

  it('enters a warning only after crossing its exact minute boundary', () => {
    expect(roomCountdownState(expiresIn(30, 1), NOW)).toBe('normal')
    expect(roomCountdownState(expiresIn(10, 1), NOW)).toBe('thirty-minute')
    expect(roomCountdownState(expiresIn(1, 1), NOW)).toBe('ten-minute')
  })

  it('presents a bounded visible label and a complete accessible label', () => {
    expect(roomCountdownLabel(expiresIn(91), NOW)).toBe('Ends in 1h 31m')
    expect(roomCountdownLabel(expiresIn(120), NOW)).toBe('Ends in 2h')
    expect(roomCountdownLabel(expiresIn(10), NOW)).toBe('Ends in 10m')
    expect(roomCountdownLabel(expiresIn(0), NOW)).toBe('Ending now')
    expect(roomCountdownLabel(expiresIn(91), NOW, true)).toBe(
      'Room ends in 1 hour 31 minutes',
    )
    expect(roomCountdownLabel(expiresIn(1), NOW, true)).toBe(
      'Room ends in 1 minute',
    )
    expect(roomCountdownLabel(expiresIn(0), NOW, true)).toBe(
      'Room is ending now',
    )
  })
})
