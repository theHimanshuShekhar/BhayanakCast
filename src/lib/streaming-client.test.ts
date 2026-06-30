import { describe, expect, test } from 'vitest'
import { canShareScreen, thumbnailIntervalMs } from './streaming-client'

describe('streaming client helpers', () => {
  test('detects display capture support', () => {
    expect(
      canShareScreen({ getDisplayMedia: async () => new MediaStream() }),
    ).toBe(true)
    expect(canShareScreen(undefined)).toBe(false)
  })

  test('uses two minute thumbnail cadence', () => {
    expect(thumbnailIntervalMs).toBe(120_000)
  })
})
