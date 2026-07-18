import { useRef } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  themePreferenceMutationKey,
  themePreferenceQueryKey,
  themePreferenceQueryOptions,
  updateThemePreference,
} from './profile-queries'
import { applyTheme, resolveTheme, type Theme } from '../theme/theme'
import type { ThemePreference as ThemePreferenceData } from '../../server/profile/preference-service'

export function ThemePreference() {
  const queryClient = useQueryClient()
  const previousThemeRef = useRef<Theme>('light')
  const preferenceQuery = useQuery(themePreferenceQueryOptions())
  const preferenceMutation = useMutation({
    mutationKey: themePreferenceMutationKey,
    mutationFn: updateThemePreference,
    onMutate: (theme) => {
      const previousPreference = queryClient.getQueryData<ThemePreferenceData>(
        themePreferenceQueryKey,
      )
      queryClient.setQueryData<ThemePreferenceData>(themePreferenceQueryKey, (current) =>
        current?.authenticated ? { ...current, theme } : current,
      )
      return { previousPreference, previousTheme: previousThemeRef.current }
    },
    onError: (_error, _theme, context) => {
      if (context?.previousPreference) {
        queryClient.setQueryData(themePreferenceQueryKey, context.previousPreference)
      }
      applyTheme(
        context?.previousTheme ?? previousThemeRef.current,
        document.documentElement,
        document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
      )
    },
    onSuccess: (data) => {
      queryClient.setQueryData(themePreferenceQueryKey, data)
    },
  })
  const isThemeMutationPending =
    useIsMutating({ mutationKey: themePreferenceMutationKey }) > 0
  const selected = preferenceQuery.data?.authenticated
    ? preferenceQuery.data.theme ?? 'system'
    : 'system'

  if (!preferenceQuery.data?.authenticated) return null

  const changeTheme = (value: string) => {
    const previousTheme: Theme =
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    previousThemeRef.current = previousTheme
    const theme = value === 'system' ? null : (value as Theme)
    const next = resolveTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches)
    applyTheme(
      next,
      document.documentElement,
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
    )
    preferenceMutation.mutate(theme)
  }

  return (
    <section aria-labelledby="theme-preference-heading" className="profile-preference">
      <h2 id="theme-preference-heading">Theme preference</h2>
      <label>
        Theme preference
        <select
          aria-label="Theme preference"
          disabled={isThemeMutationPending}
          name="theme-preference"
          value={selected}
          onChange={(event) => changeTheme(event.currentTarget.value)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </section>
  )
}
