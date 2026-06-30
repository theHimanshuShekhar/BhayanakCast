import { describe, expect, test } from 'vitest'
import { assertDevAuthEnabled, devUser } from './dev-auth'
import { assertTestAuthEnabled } from './test-auth'

describe('assertTestAuthEnabled', () => {
  test('allows test runtime only', () => {
    expect(() => assertTestAuthEnabled('test')).not.toThrow()
  })

  test('rejects development runtime', () => {
    expect(() => assertTestAuthEnabled('development')).toThrow(/not available/i)
  })
})

describe('dev auth dummy user', () => {
  test('allows development runtime only', () => {
    expect(() => assertDevAuthEnabled('development')).not.toThrow()
    expect(() => assertDevAuthEnabled('test')).toThrow(/development/i)
    expect(() => assertDevAuthEnabled('production')).toThrow(/development/i)
  })

  test('uses a non-routable dummy identity', () => {
    expect(devUser).toMatchObject({
      id: 'dev-user',
      email: 'dev-user@bhayanakcast.local',
      name: 'Dev User',
      emailVerified: true,
    })
  })
})
