import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('shipped route placeholder copy', () => {
  test('removes audited placeholder literals', () => {
    const sources = [
      readFileSync(new URL('../lib/discovery.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('./index.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./rooms/$roomId.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./profile.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./admin.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./users/$userId.tsx', import.meta.url), 'utf8'),
    ].join('\n')

    expect(sources).not.toContain('zedonyourbed')
    expect(sources).not.toContain('pako watching')
    expect(sources).not.toContain('Friend profile')
    expect(sources).not.toContain('last updated now')
    expect(sources).not.toContain('value="12"')
    expect(sources).not.toContain('demoDiscoveryRooms')
    expect(sources).not.toContain('midnight speedrun club')
    expect(sources).not.toContain('rust pair programming')
    expect(sources).not.toContain('lo-fi jam sesh')
  })
})
