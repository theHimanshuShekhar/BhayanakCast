import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('host display names', () => {
  test('discovery rooms use the host user name instead of user id', () => {
    const source = readFileSync(new URL('./discovery.ts', import.meta.url), 'utf8')

    expect(source).toContain('hostName')
    expect(source).toContain('host: row.hostName ?? room.currentHostUserId')
  })

  test('room summary uses the host user name instead of user id', () => {
    const source = readFileSync(
      new URL('./room-summary.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('hostName')
    expect(source).toContain('host: row.hostName ?? room.currentHostUserId')
  })
})
