import { describe, expect, test } from 'vitest'
import {
  themePreferenceMutationKey,
  themePreferenceQueryOptions,
} from '../../src/features/profile/profile-queries'
import {
  parseThemeOverride,
  resolveAnonymousTheme,
  resolveAuthenticatedTheme,
} from '../../src/server/profile/preference-service'

describe('account theme preference', () => {
  test('anonymous resolution uses a local override before the device preference', () => {
    expect(resolveAnonymousTheme('light', true)).toBe('light')
    expect(resolveAnonymousTheme(null, true)).toBe('dark')
  })

  test('authenticated resolution ignores anonymous local storage', () => {
    expect(resolveAuthenticatedTheme('dark', false)).toBe('dark')
    expect(resolveAuthenticatedTheme(null, true)).toBe('dark')
  })

  test('trust boundary accepts only light, dark, or null', () => {
    expect(parseThemeOverride('light')).toBe('light')
    expect(parseThemeOverride('dark')).toBe('dark')
    expect(parseThemeOverride(null)).toBeNull()
    expect(() => parseThemeOverride('sepia')).toThrow(TypeError)
    expect(() => parseThemeOverride(undefined)).toThrow(TypeError)
    expect(() => parseThemeOverride(1)).toThrow(TypeError)
  })
})
  test('refreshes the authenticated preference through normal query refetches', () => {
    expect(themePreferenceQueryOptions().staleTime).toBeUndefined()
  })

  test('shares one mutation key between Profile and global controls', () => {
    expect(themePreferenceMutationKey).toEqual(['profile', 'theme-preference'])
  })
