import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('route data wiring', () => {
  test('visible routes use real data loaders', () => {
    expect(
      readFileSync(new URL('./index.tsx', import.meta.url), 'utf8'),
    ).toContain('loadDiscoveryRooms')
    expect(
      readFileSync(new URL('./admin.tsx', import.meta.url), 'utf8'),
    ).toContain('getAdminMetrics')
    expect(
      readFileSync(new URL('./profile.tsx', import.meta.url), 'utf8'),
    ).toContain('getPublicProfile')
    expect(
      readFileSync(new URL('./rooms/$roomId.tsx', import.meta.url), 'utf8'),
    ).toContain('loadRoomSummary')
  })
})
