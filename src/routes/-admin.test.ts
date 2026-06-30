import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('admin route source', () => {
  test('renders operational dashboard and metrics loader', () => {
    const source = readFileSync(new URL('./admin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('getAdminMetrics')
    expect(source).toContain('platform stats')
    expect(source).toContain('Active streams')
  })

  test('keeps admin authorization gate', () => {
    const source = readFileSync(new URL('./admin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('isPlatformAdminUser')
    expect(source).toContain('Admin access required')
  })

  test('renders live-room count without dummy room rows', () => {
    const source = readFileSync(new URL('./admin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('live rooms')
    expect(source).toContain('streaming now')
    expect(source).toContain('No live rooms.')
    expect(source).not.toContain('ChartCard')
    expect(source).not.toContain('midnight speedrun club')
  })
})
