import { describe, expect, test } from 'vitest'
import { configuredAuthOrigin } from '../../src/server/auth/auth'

describe('authentication deployment origin', () => {
  test('fails closed without an explicit deployment origin', () => {
    expect(() => configuredAuthOrigin({})).toThrow(
      'CLOUDFLARED_PUBLIC_URL or BETTER_AUTH_URL is required',
    )
  })

  test('normalizes the configured public origin without consulting a request host', () => {
    expect(
      configuredAuthOrigin({
        BETTER_AUTH_URL: 'https://cast.example.test/',
      }),
    ).toBe('https://cast.example.test')
  })
})
