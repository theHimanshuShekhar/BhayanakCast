import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('dev session route source', () => {
  test('sets browser session cookie in development', () => {
    const source = readFileSync(
      new URL('./session.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("headers.set('set-cookie'")
    expect(source).toContain("login.headers.get('cookie')")
    expect(source).toContain('Path=/')
  })
})
