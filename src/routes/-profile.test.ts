import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('profile route sources', () => {
  test('own profile loads aggregate projection', () => {
    const source = readFileSync(
      new URL('./profile.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('getPublicProfile')
    expect(source).toContain('Route.useLoaderData')
    expect(source).not.toContain('value="12"')
  })

  test('own profile route requires an authenticated loader state', () => {
    const source = readFileSync(
      new URL('./profile.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('auth.api.getSession')
    expect(source).toContain('AuthRequiredState')
  })

  test('public profile uses userId route param and aggregate loader', () => {
    const source = readFileSync(
      new URL('./users/$userId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('params.userId')
    expect(source).toContain('getPublicProfile')
    expect(source).toContain('Route.useLoaderData')
  })

  test('public profile route requires an authenticated loader state', () => {
    const source = readFileSync(
      new URL('./users/$userId.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('auth.api.getSession')
    expect(source).toContain('!profileState.authenticated')
    expect(source).toContain('AuthRequiredState')
  })

  test('profile routes render prototype profile structure', () => {
    const own = readFileSync(new URL('./profile.tsx', import.meta.url), 'utf8')
    const publicProfile = readFileSync(
      new URL('./users/$userId.tsx', import.meta.url),
      'utf8',
    )

    for (const source of [own, publicProfile]) {
      expect(source).toContain('profile-banner')
      expect(source).toContain('Top co-users')
      expect(source).toContain('progress')
    }
  })

  test('profile routes render aggregate top co-users', () => {
    const own = readFileSync(new URL('./profile.tsx', import.meta.url), 'utf8')
    const publicProfile = readFileSync(
      new URL('./users/$userId.tsx', import.meta.url),
      'utf8',
    )

    expect(own).toContain('profile.topCoUsers.map')
    expect(publicProfile).toContain('profile.topCoUsers.map')
  })
})
