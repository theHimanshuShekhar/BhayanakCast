import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  themePreferenceMutationKey,
  themePreferenceQueryKey,
  themePreferenceQueryOptions,
  updateThemePreference,
} from '../profile/profile-queries'
import type { ThemePreference } from '../../server/profile/preference-service'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeStorage,
  readThemeOverride,
  resolveTheme,
  writeThemeOverride,
  type Theme,
} from './theme'

const DARK_SCHEME = '(prefers-color-scheme: dark)'
const useThemeLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export interface ThemeToggleProps {
  readonly initialPreference?: ThemePreference
}

export function ThemeToggle({ initialPreference }: ThemeToggleProps) {
  const queryClient = useQueryClient()
  const preferenceQuery = useQuery({
    ...themePreferenceQueryOptions(),
    ...(initialPreference ? { initialData: initialPreference } : {}),
  })
  const previousThemeRef = useRef<Theme>('light')
  const preferenceMutation = useMutation({
    mutationKey: themePreferenceMutationKey,
    mutationFn: updateThemePreference,
    onMutate: (nextTheme) => {
      const previousPreference = queryClient.getQueryData<ThemePreference>(
        themePreferenceQueryKey,
      )
      queryClient.setQueryData<ThemePreference>(themePreferenceQueryKey, (current) =>
        current?.authenticated ? { ...current, theme: nextTheme } : current,
      )
      return { previousPreference, previousTheme: previousThemeRef.current }
    },
    onError: (_error, _nextTheme, context) => {
      if (context?.previousPreference) {
        queryClient.setQueryData(themePreferenceQueryKey, context.previousPreference)
      }
      applyBrowserTheme(context?.previousTheme ?? previousThemeRef.current)
      setTheme(context?.previousTheme ?? previousThemeRef.current)
    },
    onSuccess: (data) => {
      queryClient.setQueryData(themePreferenceQueryKey, data)
    },
  })
  const isThemeMutationPending =
    useIsMutating({ mutationKey: themePreferenceMutationKey }) > 0
  const [theme, setTheme] = useState<Theme | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useThemeLayoutEffect(() => {
    const value = document.documentElement.dataset.theme
    if (value === 'light' || value === 'dark') setTheme(value)
  }, [])

  useEffect(() => {
    const media = window.matchMedia(DARK_SCHEME)
    const syncTheme = () => {
      const preference = preferenceQuery.data
      const override = preference?.authenticated
        ? preference.theme
        : readThemeOverride(getThemeStorage(window))
      const next = resolveTheme(override, media.matches)
      applyBrowserTheme(next)
      setTheme(next)
      toggleRef.current?.setAttribute(
        'aria-label',
        next === 'dark' ? 'Light theme' : 'Dark theme',
      )
      toggleRef.current?.setAttribute('aria-pressed', String(next === 'dark'))
    }
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) syncTheme()
    }
    const initialSync = window.setTimeout(syncTheme)
    media.addEventListener('change', syncTheme)
    window.addEventListener('storage', syncStoredTheme)
    return () => {
      window.clearTimeout(initialSync)
      media.removeEventListener('change', syncTheme)
      window.removeEventListener('storage', syncStoredTheme)
    }
  }, [preferenceQuery.data])

  const toggleTheme = () => {
    const current = theme ?? document.documentElement.dataset.theme
    const previousTheme: Theme = current === 'dark' ? 'dark' : 'light'
    const next: Theme = previousTheme === 'dark' ? 'light' : 'dark'
    if (preferenceQuery.data?.authenticated) {
      previousThemeRef.current = previousTheme
      applyBrowserTheme(next)
      setTheme(next)
      preferenceMutation.mutate(next)
    } else {
      applyBrowserTheme(next)
      setTheme(next)
      writeThemeOverride(next, getThemeStorage(window))
    }
  }

  return (
    <button
      ref={toggleRef}
      aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      aria-pressed={theme === null ? undefined : theme === 'dark'}
      className="theme-toggle"
      data-tooltip="Theme"
      disabled={isThemeMutationPending}
      type="button"
      onClick={toggleTheme}
    >
      <span aria-hidden="true" className="theme-toggle__icons">
        <svg className="theme-toggle__sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
        </svg>
        <svg className="theme-toggle__moon" viewBox="0 0 24 24">
          <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8a8.5 8.5 0 1 0 11.6 11.6Z" />
        </svg>
      </span>
      <span>Theme</span>
    </button>
  )
}

function applyBrowserTheme(theme: Theme) {
  applyTheme(
    theme,
    document.documentElement,
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
  )
}
