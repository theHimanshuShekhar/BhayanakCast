import { queryOptions } from '@tanstack/react-query'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
  type ThemeOverride,
} from '../../server/profile/preference-service'

export const themePreferenceQueryKey = ['profile', 'theme-preference'] as const
export const themePreferenceMutationKey = themePreferenceQueryKey

export function themePreferenceQueryOptions() {
  return queryOptions<ThemePreference>({
    queryKey: themePreferenceQueryKey,
    queryFn: ({ signal }) => getThemePreference({ signal }),
  })
}

export function updateThemePreference(theme: ThemeOverride) {
  return setThemePreference({ data: { theme } })
}
